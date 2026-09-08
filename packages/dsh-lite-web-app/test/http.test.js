import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { createWebHandler } from '../src/http.js'

async function fixture(runtime) {
  const server = createServer(createWebHandler(runtime))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const base = `http://127.0.0.1:${server.address().port}`
  const post = (input, path = '/api/chat', origin = base) => fetch(base + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify(input),
  })
  const close = () => { server.close(); server.closeAllConnections() }
  return { base, post, close }
}

test('静态页面、输入、同源保护与会话释放', async () => {
  const released = []
  const f = await fixture({
    status: async () => ({ model: 'fixture', configured: true }),
    run: async () => ({ sessionId: 'fixture', finalResponse: 'hello' }),
    release: async (id) => { released.push(id) },
  })
  try {
    assert.match(await (await fetch(f.base)).text(), /今天，从什么开始/)
    assert.equal((await f.post({ prompt: '' })).status, 400)
    assert.equal((await f.post({ prompt: 'x' }, '/api/chat', 'https://example.com')).status, 403)
    assert.equal((await f.post({ prompt: 'x'.repeat(40000) })).status, 400)
    assert.equal((await f.post({ prompt: 'hello' })).status, 200)
    assert.equal((await f.post({ sessionId: 'fixture' }, '/api/session/close')).status, 200)
    assert.deepEqual(released, ['fixture'])
    assert.equal((await fetch(f.base + '/package.json')).status, 404)
  } finally { f.close() }
})

test('缺少凭据拒绝调用', async () => {
  const f = await fixture({
    status: async () => ({ configured: false }),
    run: async () => { assert.fail('Must not call model') },
  })
  try { assert.equal((await f.post({ prompt: 'hello' })).status, 503) }
  finally { f.close() }
})

test('并发请求拒绝、模型失败脱敏并让客户端失效旧会话', async () => {
  const started = Promise.withResolvers()
  const pending = Promise.withResolvers()
  const f = await fixture({
    status: async () => ({ configured: true }),
    run: () => { started.resolve(); return pending.promise },
  })
  try {
    const first = f.post({ prompt: 'hello' })
    await started.promise
    assert.equal((await f.post({ prompt: 'again' })).status, 409)
    pending.reject(new Error('secret fixture key'))
    const response = await first
    const result = await response.json()
    assert.equal(response.status, 502)
    assert.equal(result.sessionExpired, true)
    assert.doesNotMatch(JSON.stringify(result), /secret/)
  } finally { f.close() }
})
