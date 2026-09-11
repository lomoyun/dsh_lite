import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { verifyFriendlyConfiguration } from './friendly-flow.js'
import { verifyPromptConfiguration } from './prompt-flow.js'
import { verifyWorkspace, verifyWorkspaceRestart } from './workspace-flow.js'
import { verifyTables, verifyTableRestart } from './table-flow.js'
import { mockTableResponse } from '../../dsh-lite-web-app/test/table-fixtures.js'
import { mockActionResponse } from '../../dsh-lite-web-app/test/action-fixtures.js'
import { verifyActions, verifyActionRestart } from './action-flow.js'

async function listen(server) {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return server.address().port
}
async function close(server) {
  if (!server.listening) return
  const done = once(server, 'close')
  server.close(); server.closeAllConnections()
  await done
}
async function post(base, path, input, origin = base) {
  return fetch(`${base}/api/model-config/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify(input),
  })
}
const root = fileURLToPath(new URL('../../../', import.meta.url))
const scratch = join(root, '.dsh')

async function boot(home, overlay, base) {
  const child = spawn(process.execPath, [join(root, 'scripts/start.mjs'), '--patch', overlay], {
    cwd: home, env: { ...process.env, DSH_HOME: home,
      DSH_LITE_PROVIDER: 'deepseek-official', DSH_LITE_MODEL: 'deepseek-v4-flash' },
    windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (chunk) => { output += chunk })
  child.stderr.on('data', (chunk) => { output += chunk })
  const close = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return
    const exited = once(child, 'exit')
    child.kill()
    await exited
  }
  try {
    for (let attempt = 0; attempt < 150; attempt++) {
      if (child.exitCode !== null) throw new Error(output)
      try { if ((await fetch(base + '/api/status')).ok) return { close, output: () => output } } catch {}
      await delay(100)
    }
    throw new Error('Startup timeout: ' + output)
  } catch (error) { await close(); throw error }
}

async function fixture() {
  await mkdir(scratch, { recursive: true })
  const home = await mkdtemp(join(scratch, 'lite-test-'))
  const reserve = createServer()
  const port = await listen(reserve)
  await close(reserve)
  const overlay = join(home, 'config.json')
  const patches = [
    { id: 'lite-http', config: { host: '127.0.0.1', port } },
    { id: 'session-telemetry-otel', disabled: true },
    { id: 'session-title-llm', disabled: true },
  ]
  if (process.env.MODEL_CONFIG_TEST_ENTRY) patches.push({
    id: 'model-config-ui', name: pathToFileURL(process.env.MODEL_CONFIG_TEST_ENTRY).href,
  })
  if (process.env.PROMPT_CONFIG_TEST_ENTRY) patches.push({
    id: 'prompt-config-ui', name: pathToFileURL(process.env.PROMPT_CONFIG_TEST_ENTRY).href,
  })
  if (process.env.WORKSPACE_TEST_ENTRY) patches.push({ id: 'lite-workspace', name: pathToFileURL(process.env.WORKSPACE_TEST_ENTRY).href })
  if (process.env.WEB_APP_TEST_ENTRY) patches.push({ id: 'lite-web-app', name: pathToFileURL(process.env.WEB_APP_TEST_ENTRY).href })
  await writeFile(overlay, JSON.stringify(patches))
  const base = `http://127.0.0.1:${port}`
  const harness = await boot(home, overlay, base)
  return { home, base, harness, overlay }
}

async function chat(base, prompt, sessionId) {
  const response = await fetch(base + '/api/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, sessionId }),
  })
  const body = await response.json()
  assert.equal(response.status, 200, JSON.stringify(body))
  return body
}

test('真实 Cordis 加载、保存、凭据隔离、模型调用和重启恢复', { timeout: 90_000 }, async () => {
  const f = await fixture()
  const received = []
  const mock = createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/v1/models') {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      return response.end(JSON.stringify({ data: [{ id: 'friendly-model' }, { id: 'extra-model' }] }))
    }
    let body = ''
    for await (const chunk of request) body += chunk
    received.push({ url: request.url, auth: request.headers.authorization, body: JSON.parse(body) })
    const action = mockActionResponse(JSON.parse(body))
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    const chunk = { id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture-model',
      choices: [{ index: 0, delta: action?.delta ?? { role: 'assistant', content: mockTableResponse(JSON.parse(body)) ?? '配置已生效' }, finish_reason: null }] }
    response.write(`data: ${JSON.stringify(chunk)}\n\n`)
    chunk.choices = [{ index: 0, delta: {}, finish_reason: action?.finishReason ?? 'stop' }]
    response.write(`data: ${JSON.stringify(chunk)}\n\n`)
    response.end(`data: ${JSON.stringify({ ...chunk, choices: [], usage: {
      prompt_tokens: 100, completion_tokens: 20, total_tokens: 120,
      prompt_tokens_details: { cached_tokens: 40 }, completion_tokens_details: { reasoning_tokens: 5 },
    } })}\n\ndata: [DONE]\n\n`)
  })
  const mockPort = await listen(mock)
  let restarted
  let succeeded = false
  try {
    await verifyConfiguration(f, mockPort)
    await verifyMultipleModels(f, mockPort)
    await verifyConversations({ f, mockPort, received })
    const savedTable = await verifyTables({ f, received })
    const savedAction = await verifyActions({ f, received })
    await verifyFriendlyConfiguration({ f, mockPort, received })
    await verifyPromptConfiguration({ f, received })
    const saved = await verifyWorkspace({ f, received })
    await f.harness.close()
    restarted = await boot(f.home, f.overlay, f.base)
    await verifyWorkspaceRestart({ f, received, saved })
    await verifyTableRestart(f, savedTable)
    await verifyActionRestart(f, savedAction)
    const restored = await (await fetch(`${f.base}/api/model-config/state`)).json()
    assert.equal(restored.selected.provider, 'second-route')
    assert.equal(restored.selected.maxTokens, 512)
    assert.equal(restored.providers.find((p) => p.id === 'fixture-route').credential.configured, true)
    const prompt = await (await fetch(f.base + '/api/prompt-config/state')).json()
    assert.equal(prompt.mode, 'persona')
    assert.equal(prompt.text, 'PERSISTED_PROMPT {{model}}')
    await restarted.close()
    await withoutModelPlugin(f)
    succeeded = true
  } finally {
    await restarted?.close(); await f.harness.close(); await close(mock)
    // 只清理由本测试创建的唯一临时目录。
    assert.ok(resolve(f.home).startsWith(resolve(scratch)))
    if (succeeded || !process.env.DSH_TEST_KEEP_FAILED) await rm(f.home, { recursive: true, force: true })
    else console.error('Failed test artifacts:', f.home, f.harness.output().slice(-8000))
  }
})

async function selectSecondModel(f, mockPort) {
  const state = await (await fetch(f.base + '/api/model-config/state')).json()
  const provider = await post(f.base, 'provider', {
    provider: 'second-route', api: 'openai-completions',
    baseURL: `http://127.0.0.1:${mockPort}/v1`, apiKeyEnv: 'SECOND_FIXTURE_KEY',
    modelId: 'second-model', contextWindow: 32768, maxTokens: 4096, revision: state.providerRevision,
  })
  assert.equal(provider.status, 200, await provider.text())
  assert.equal((await post(f.base, 'credential', {
    provider: 'second-route', apiKey: 'second-fixture-not-a-real-secret',
  })).status, 200)
  assert.equal((await post(f.base, 'selection', {
    provider: 'second-route', model: 'second-model', revision: state.revision,
  })).status, 200)
}

async function withoutModelPlugin(f) {
  const path = join(f.home, 'profiles/lite/package.json')
  const manifest = JSON.parse(await readFile(path, 'utf8'))
  manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.filter((name) => !['@dsh-lite/model-config', '@dsh-lite/prompt-config'].includes(name))
  await writeFile(path, JSON.stringify(manifest))
  const runtime = await boot(f.home, f.overlay, f.base)
  try {
    assert.equal((await fetch(f.base + '/models')).status, 404)
    assert.equal((await fetch(f.base + '/prompts')).status, 404)
    assert.equal((await chat(f.base, 'Chat without configuration plugin')).finalResponse, '配置已生效')
    const preserved = JSON.parse(await readFile(path, 'utf8'))
    assert.deepEqual(preserved.dsh.profile.bundles, manifest.dsh.profile.bundles)
  } finally { await runtime.close() }
}

async function verifyConfiguration(f, mockPort) {
  const state = await (await fetch(`${f.base}/api/model-config/state`)).json()
  assert.ok(state.providers.some((p) => p.id === 'deepseek-official'))
  assert.match(await (await fetch(`${f.base}/models`)).text(), /选择你的思考引擎/)
  assert.equal((await post(f.base, 'provider', {}, 'https://example.com')).status, 403)
  assert.equal((await post(f.base, 'provider', { provider: '__proto__' })).status, 400)
  const provider = { provider: 'fixture-route', api: 'openai-completions',
    baseURL: `http://127.0.0.1:${mockPort}/v1`, apiKeyEnv: 'FIXTURE_MODEL_KEY',
    modelId: 'fixture-model', contextWindow: 32768, maxTokens: 4096, revision: state.providerRevision }
  const saved = await post(f.base, 'provider', provider)
  assert.equal(saved.status, 200, await saved.text())
  assert.equal((await post(f.base, 'provider', provider)).status, 409)
  const key = await post(f.base, 'credential', { provider: 'fixture-route', apiKey: 'fixture-not-a-real-secret' })
  assert.equal(key.status, 200, await key.text())
  const selected = await post(f.base, 'selection', { provider: 'fixture-route', model: 'fixture-model', revision: state.revision })
  assert.equal(selected.status, 200, await selected.text())
  assert.equal((await post(f.base, 'limits', { maxTokens: 1024, revision: state.limitsRevision })).status, 200)
  const updated = await (await fetch(`${f.base}/api/model-config/state`)).text()
  assert.doesNotMatch(updated, /fixture-not-a-real-secret/)
  assert.equal(JSON.parse(updated).selected.model, 'fixture-model')
}

async function verifyConversations({ f, mockPort, received }) {
  const configured = await (await fetch(`${f.base}/api/model-config/state`)).json()
  const result = await chat(f.base, 'Reply briefly')
  assert.equal(result.finalResponse, '配置已生效')
  assert.equal(result.usage.inputTokens, 60)
  assert.equal(result.usage.cacheReadTokens, 40)
  assert.equal(result.usage.outputTokens, 20)
  assert.equal(result.usage.totalTokens, 120)
  assert.equal(received[0].url, '/v1/chat/completions')
  assert.equal(received[0].auth, 'Bearer fixture-not-a-real-secret')
  assert.equal(received[0].body.model, 'fixture-model')
  assert.equal(received[0].body.max_tokens ?? received[0].body.max_completion_tokens, 1024)
  const followup = await chat(f.base, 'Continue', result.sessionId)
  assert.equal(followup.sessionId, result.sessionId)
  assert.equal(followup.sessionUsage.totalTokens, 240)
  assert.equal(followup.sessionUsage.reportedCalls, 2)
  const history = JSON.stringify(received[1].body.messages)
  assert.match(history, /Reply briefly/)
  assert.match(history, /Continue/)
  assert.match(history, /配置已生效/)
  const limits = await post(f.base, 'limits', { maxTokens: 512, revision: configured.limitsRevision })
  assert.equal(limits.status, 200)
  await selectSecondModel(f, mockPort)
  await chat(f.base, 'Same session', result.sessionId)
  assert.equal(received[2].body.model, 'fixture-model')
  assert.equal(received[2].body.max_tokens ?? received[2].body.max_completion_tokens, 1024)
  await chat(f.base, 'New session')
  assert.equal(received[3].body.model, 'second-model')
  assert.equal(received[3].body.max_tokens ?? received[3].body.max_completion_tokens, 512)
}

async function verifyMultipleModels(f, mockPort) {
  const state = await (await fetch(f.base + '/api/model-config/state')).json()
  const route = state.providers.find((item) => item.id === 'fixture-route')
  const response = await post(f.base, 'provider', {
    provider: route.id, baseURL: `http://127.0.0.1:${mockPort}/v1`, apiKeyEnv: 'FIXTURE_MODEL_KEY',
    api: 'openai-completions', modelId: 'another-model', contextWindow: 32768,
    maxTokens: 4096, revision: route.revision,
  })
  assert.equal(response.status, 200, await response.text())
  const updated = await (await fetch(f.base + '/api/model-config/state')).json()
  const models = updated.providers.find((item) => item.id === route.id).configuredModels.map((item) => item.id)
  assert.deepEqual(models, ['fixture-model', 'another-model'])
  assert.equal(updated.selected.model, 'fixture-model')
  const duplicate = await post(f.base, 'provider', { provider: route.id, createOnly: true })
  assert.equal(duplicate.status, 400)
}
