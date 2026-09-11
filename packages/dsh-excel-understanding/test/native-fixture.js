import { createServer } from 'node:http'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { mockExcelResponse } from './model-fixture.js'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const scratch = join(root, '.dsh')
function modelServer(received, respond) {
  return createServer(async (request, response) => {
    let text = ''; for await (const chunk of request) text += chunk
    const body = JSON.parse(text); received.push(body)
    const reply = respond(body) ?? { delta: { role: 'assistant', content: '本地测试回复' }, finishReason: 'stop' }
    if (reply.delayMs) await delay(reply.delayMs)
    const chunk = { id: 'excel-test', object: 'chat.completion.chunk', created: 1, model: 'excel-test', choices: [{ index: 0, delta: reply.delta, finish_reason: null }] }
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.write(`data: ${JSON.stringify(chunk)}\n\n`)
    response.write(`data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: reply.finishReason }] })}\n\n`)
    response.end('data: [DONE]\n\n')
  })
}
export async function nativeFixture(t, vision = false, options = {}) {
  await mkdir(scratch, { recursive: true })
  const home = await mkdtemp(join(scratch, 'excel-native-')), received = []
  const server = modelServer(received, options.respond ?? mockExcelResponse)
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const patches = [
    { id: 'lite-http', config: { host: '127.0.0.1', port: 0 } },
    { id: 'llm-pi-ai', config: { providers: { 'excel-fixture': { displayName: 'Excel fixture', api: 'openai-completions',
      baseURL: `http://127.0.0.1:${server.address().port}/v1`, apiKeyEnv: 'EXCEL_FIXTURE_KEY',
      models: [{ id: 'excel-test', contextWindow: options.contextWindow ?? 65536, maxTokens: 4096, input: vision ? ['text', 'image'] : ['text'] }],
    } } } },
    { id: 'agent-default-model', config: { provider: 'excel-fixture', model: 'excel-test' } },
    { id: 'session-title-llm', disabled: true }, { id: 'session-telemetry-otel', disabled: true },
  ]
  patches.push(...(options.patches ?? []))
  const patch = join(home, 'fixture.json')
  await writeFile(patch, JSON.stringify(patches))
  const fixture = { home, received, child: null, output: '', base: '', async close() {
    if (this.child && this.child.exitCode === null && this.child.signalCode === null) {
      const exited = once(this.child, 'exit'); this.child.kill(); await exited
    }
  }, async boot() {
    this.output = ''
    this.child = spawn(process.execPath, [join(root, 'scripts/start.mjs'), '--patch', patch], {
      cwd: home, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...options.env, DSH_HOME: home, EXCEL_FIXTURE_KEY: 'not-a-real-secret' },
    })
    this.child.stdout.on('data', (chunk) => { this.output += chunk })
    this.child.stderr.on('data', (chunk) => { this.output += chunk })
    for (let attempt = 0; attempt < 150; attempt++) {
      if (this.child.exitCode !== null) throw new Error(this.output)
      const match = /DSH Lite: (http:\/\/127\.0\.0\.1:\d+)/.exec(this.output)
      if (match) { this.base = match[1]; return }
      await delay(100)
    }
    throw new Error('启动超时：' + this.output)
  } }
  t.after(async () => {
    await fixture.close(); server.close(); server.closeAllConnections()
    if (relative(scratch, home).startsWith('excel-native-')) await rm(home, { recursive: true, force: true })
  })
  await fixture.boot(); return fixture
}
export async function post(fixture, path, input, expected = 200) {
  const response = await fetch(fixture.base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
  const value = await response.json()
  if (response.status !== expected) throw new Error(`${path}: ${response.status} ${JSON.stringify(value)}\n${fixture.output}`)
  return value
}
