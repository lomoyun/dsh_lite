import assert from 'node:assert/strict'
import { test } from 'node:test'
import { nativeFixture, post } from './native-fixture.js'

test('真实 DSH 无进展超时返回 504；原附件可查阅，重启后能继续对话', { timeout: 30000 }, async (t) => {
  let calls = 0
  const f = await nativeFixture(t, false, {
    patches: [{ id: 'lite-web-app', config: { cwd: process.cwd(), timeoutMs: 10000, idleTimeoutMs: 1000 } }],
    respond: () => ({ delayMs: calls++ === 0 ? 2000 : 0,
      delta: { role: 'assistant', content: '已继续核对原附件。' }, finishReason: 'stop' }),
  })
  const { sessionId } = await post(f, '/api/session/prepare', {})
  const upload = await fetch(f.base + '/api/excel/upload', { method: 'POST', body: 'name,value\nflow,10',
    headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': 'timeout.csv', 'X-Session-Id': sessionId } })
  assert.equal(200, upload.status)
  const { file } = await upload.json(), id = { sessionId, fileId: file.fileId }
  const timeout = await post(f, '/api/chat', { sessionId, prompt: '核对流量', workbooks: [file] }, 504)
  assert.equal('TURN_IDLE_TIMEOUT', timeout.code); assert.equal(sessionId, timeout.sessionId)
  assert.equal('ready', (await post(f, '/api/excel/inspect', id)).file.status)
  await f.close(); await f.boot()
  const opened = await post(f, '/api/session/open', { sessionId })
  assert.equal('', opened.readOnlyReason)
  assert.equal('ready', (await post(f, '/api/excel/inspect', id)).file.status)
  const resumed = await post(f, '/api/chat', { sessionId, prompt: '继续核对流量' })
  assert.equal('已继续核对原附件。', resumed.finalResponse)
})
