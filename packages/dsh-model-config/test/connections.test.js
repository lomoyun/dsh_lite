import assert from 'node:assert/strict'
import { test } from 'node:test'
import { saveConnection, saveModel } from '../src/connections.js'
import { fetchCatalog } from '../src/catalog.js'

function fixture({ writable = true, credentialFailure = false, limitsFailure = false } = {}) {
  const writes = []
  const profile = { baseURL: 'http://127.0.0.1:12345/v1', apiKeyEnv: 'TEST_KEY', api: 'openai-completions',
    models: [{ id: 'model-one', contextWindow: 32768, maxTokens: 4096, input: ['text'], name: '保留名称' }] }
  const ctx = {
    llm: { listConfigurableProviders: () => [{ provider: 'test-route', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'test-route'] }] },
    settings: {
      get: (ns) => ns === 'llm-pi-ai' ? { providers: { 'test-route': profile } } : { maxTokens: 8192, modelLimits: [] },
      describe: () => [{ ns: 'llm-pi-ai', revision: 1 }, { ns: 'model-config-ui', revision: 1 }],
      mutate: async (ns, ops) => { writes.push({ ns, ops }) },
      update: async () => { if (limitsFailure) throw new Error('disk failure') },
    },
    credentials: {
      describe: async () => ({ writable, configured: true }),
      set: async () => { if (credentialFailure) throw new Error('secret must not escape') },
      resolve: async () => ({ value: 'test-only-secret' }),
    },
  }
  return { ctx, writes }
}
const input = { provider: 'test-route', name: '中文连接', baseURL: 'http://127.0.0.1:12345/v1', apiKey: 'fake-test-key', revision: 1 }

test('环境密钥只读时在修改连接之前拒绝', async () => {
  const { ctx, writes } = fixture({ writable: false })
  await assert.rejects(saveConnection(ctx, input), /启动环境/)
  assert.equal(writes.length, 0)
})
test('凭据失败返回可重试的连接 ID 和部分成功，不泄露异常', async () => {
  const { ctx, writes } = fixture({ credentialFailure: true })
  const result = await saveConnection(ctx, input)
  assert.equal(result.partial, true)
  assert.equal(result.provider, 'test-route')
  assert.equal(writes.length, 1)
  assert.doesNotMatch(JSON.stringify(result), /secret must not escape|fake-test-key/)
})
test('模型编辑保留额外元数据，跨服务部分失败明确告知', async () => {
  const { ctx, writes } = fixture({ limitsFailure: true })
  const result = await saveModel(ctx, { provider: 'test-route', modelId: 'model-one',
    contextWindow: 32768, maxTokens: 512, revision: 1, limitsRevision: 1 })
  const models = writes[0].ops.find((op) => op.path.at(-1) === 'models').value
  assert.equal(models[0].name, '保留名称')
  assert.deepEqual(models[0].input, ['text'])
  assert.equal(result.partial, true)
})
test('目录探测不跟随重定向，错误不回传服务商响应或密钥', async (t) => {
  const { ctx } = fixture()
  let options
  t.mock.method(globalThis, 'fetch', async (_, init) => {
    options = init
    return new Response('test-only-secret raw provider error', { status: 401 })
  })
  await assert.rejects(fetchCatalog(ctx, { provider: 'test-route' }), /HTTP 401/)
  assert.equal(options.redirect, 'error')
  assert.equal(options.headers.Authorization, 'Bearer test-only-secret')
})
