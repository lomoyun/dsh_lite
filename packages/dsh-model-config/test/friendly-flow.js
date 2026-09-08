import assert from 'node:assert/strict'

export async function verifyFriendlyConfiguration({ f, mockPort, received }) {
  const state = () => fetch(f.base + '/api/model-config/state').then((r) => r.json())
  const post = (action, input) => fetch(`${f.base}/api/model-config/${action}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  })
  const initial = await state()
  const callsBefore = received.length
  const saved = await post('connection', { name: '我的测试连接', api: 'openai-completions',
    baseURL: `http://127.0.0.1:${mockPort}/v1`, apiKey: 'friendly-test-only',
    modelId: 'friendly-model', contextWindow: 32768, maxTokens: 8192, revision: initial.providerRevision })
  assert.equal(saved.status, 200, await saved.clone().text())
  const { provider } = await saved.json()
  let current = await state()
  let route = current.providers.find((p) => p.id === provider)
  assert.equal(route.name, '我的测试连接')
  assert.match(route.apiKeyEnv, /^DSH_LITE_CONNECTION_/)
  assert.equal(route.credential.configured, true)
  assert.equal(current.selected.provider, initial.selected.provider)
  assert.equal(received.length, callsBefore, '保存不调用推理')
  assert.doesNotMatch(JSON.stringify(current), /friendly-test-only/)
  const catalog = await post('catalog', { provider })
  assert.equal(catalog.status, 200, await catalog.clone().text())
  assert.deepEqual((await catalog.json()).models, [{ id: 'friendly-model' }, { id: 'extra-model' }])
  const model = { provider, modelId: 'extra-model', contextWindow: 32768, maxTokens: 777,
    revision: route.revision, limitsRevision: current.limitsRevision }
  assert.equal((await post('model', { ...model, maxTokens: 40000 })).status, 400)
  const added = await post('model', model)
  assert.equal(added.status, 200, await added.clone().text())
  assert.equal((await added.json()).partial, undefined)
  assert.equal((await post('model', model)).status, 409)
  current = await state()
  route = current.providers.find((p) => p.id === provider)
  assert.deepEqual(route.configuredModels.map((m) => m.id), ['friendly-model', 'extra-model'])
  assert.equal(current.modelLimits.find((m) => m.provider === provider).maxTokens, 777)
  await verifyChosenChat({ f, provider, received })
  const renamed = await post('connection', { provider, name: '已重命名连接', baseURL: route.baseURL,
    api: route.api, apiKey: '', revision: route.revision })
  assert.equal(renamed.status, 200)
  current = await state()
  assert.equal(current.providers.find((p) => p.id === provider).credential.configured, true)
  assert.equal(current.providers.find((p) => p.id === provider).name, '已重命名连接')
  assert.equal(current.selected.provider, initial.selected.provider)
}

async function verifyChosenChat({ f, provider, received }) {
  const response = await fetch(f.base + '/api/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'Use chosen model', choice: { provider, model: 'extra-model', maxTokens: 9999 } }),
  })
  assert.equal(response.status, 200, await response.clone().text())
  const first = await response.json()
  assert.equal(first.provider, provider)
  assert.equal(first.model, 'extra-model')
  assert.equal(received.at(-1).body.max_tokens ?? received.at(-1).body.max_completion_tokens, 777)
  const next = await fetch(f.base + '/api/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'Keep current model', sessionId: first.sessionId,
      choice: { provider: 'second-route', model: 'second-model' } }),
  })
  assert.equal(next.status, 200)
  assert.equal((await next.json()).model, 'extra-model')
}
