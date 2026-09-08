// 浏览器验收专用：隔离 home、虚构密钥、本地模型，不接触用户配置。
import { createServer } from 'node:http'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join, relative } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const scratch = join(root, '.dsh')
await mkdir(scratch, { recursive: true })
const home = await mkdtemp(join(scratch, 'ui-fixture-'))
const mock = createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/v1/models') {
    response.writeHead(200, { 'Content-Type': 'application/json' })
    return response.end(JSON.stringify({ data: [{ id: 'demo-model' }, { id: 'demo-reasoner' }] }))
  }
  for await (const chunk of request) { /* 排空本地测试请求。 */ }
  response.writeHead(200, { 'Content-Type': 'text/event-stream' })
  const chunk = { id: 'ui-test', object: 'chat.completion.chunk', created: 1, model: 'demo-model',
    choices: [{ index: 0, delta: { role: 'assistant', content: '这是本地测试回复，Token 统计已返回。' }, finish_reason: null }] }
  response.write(`data: ${JSON.stringify(chunk)}\n\n`)
  chunk.choices = [{ index: 0, delta: {}, finish_reason: 'stop' }]
  response.write(`data: ${JSON.stringify(chunk)}\n\n`)
  response.end(`data: ${JSON.stringify({ ...chunk, choices: [], usage: {
    prompt_tokens: 100, completion_tokens: 20, total_tokens: 120,
    prompt_tokens_details: { cached_tokens: 40 },
  } })}\n\ndata: [DONE]\n\n`)
})
mock.listen(0, '127.0.0.1')
await once(mock, 'listening')
const baseURL = `http://127.0.0.1:${mock.address().port}/v1`
const patch = join(home, 'ui.json')
await writeFile(patch, JSON.stringify([
  { id: 'lite-http', config: { host: '127.0.0.1', port: 0 } },
  { id: 'llm-pi-ai', config: { providers: { 'demo-config': {
    displayName: '本地演示连接', api: 'openai-completions', baseURL, apiKeyEnv: 'UI_FIXTURE_KEY',
    models: [{ id: 'demo-model', contextWindow: 32768, maxTokens: 4096 }],
  } } } },
  { id: 'agent-default-model', config: { provider: 'demo-config', model: 'demo-model' } },
  { id: 'session-title-llm', disabled: true }, { id: 'session-telemetry-otel', disabled: true },
]))
const child = spawn(process.execPath, [join(root, 'scripts/start.mjs'), '--patch', patch], {
  env: { ...process.env, DSH_HOME: home, UI_FIXTURE_KEY: 'ui-fixture-not-a-real-secret' },
  stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true,
})
console.log('Local mock endpoint:', baseURL)
let stopping = false
async function stop() {
  if (stopping) return
  stopping = true
  if (child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit'); child.kill(); await exited
  }
  mock.close(); mock.closeAllConnections()
  if (relative(scratch, home).startsWith('ui-fixture-')) await rm(home, { recursive: true, force: true })
}
process.on('SIGINT', () => void stop())
process.on('SIGTERM', () => void stop())
child.on('exit', () => void stop())
