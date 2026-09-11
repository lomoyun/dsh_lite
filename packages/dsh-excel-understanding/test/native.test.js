import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { nativeFixture, post } from './native-fixture.js'
import { customerWorkbook } from './model-fixture.js'
import { decodeChatInput } from '../../dsh-lite-web-app/public/table-message.js'

async function upload(f, sessionId) {
  const response = await fetch(f.base + '/api/excel/upload', { method: 'POST', body: customerWorkbook(),
    headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': 'customer.xlsx', 'X-Session-Id': sessionId } })
  const value = await response.json()
  assert.equal(200, response.status, `${JSON.stringify(value)}\n${f.output}`); return value.file
}
function assertTools(reply) {
  assert.equal(6, reply.details.length)
  for (const detail of reply.details) assert.equal('completed', detail.status, detail.text)
  assert.ok(reply.details.at(-1).excel.resultId)
  assert.equal(0, reply.actions.length)
}
test('真实 DSH 工具循环：按引用上传、跨 Sheet 读取、发布、追问、重启、归属与删除', { timeout: 120000 }, async (t) => {
  const f = await nativeFixture(t), { sessionId } = await post(f, '/api/session/prepare', {})
  assert.equal(0, f.received.length)
  const file = await upload(f, sessionId), second = await upload(f, sessionId)
  assert.notEqual(file.fileId, second.fileId)
  const reply = await post(f, '/api/chat', { sessionId, prompt: '解析工作簿测试', workbooks: [file] })
  assertTools(reply)
  const firstUser = f.received[0].messages.find((message) => typeof message.content === 'string' && decodeChatInput(message.content)?.workbooks)
  const input = decodeChatInput(firstUser.content)
  assert.equal(2, input.workbooks[0].sheets.length); assert.equal(0, input.tables.length)
  assert.ok(!JSON.stringify(input.workbooks).includes('00123'))
  assert.equal(false, f.received.some((request) => JSON.stringify(request).includes('image_url')))
  const id = { sessionId, fileId: file.fileId }, resultId = reply.details.at(-1).excel.resultId
  const saved = await post(f, '/api/excel/result', { ...id, resultId })
  assert.equal('1,25', saved.fields[0].raw); assert.equal(false, saved.validation.calculationReady)
  if (process.platform === 'linux' || process.env.EXCEL_RENDER_WSL) {
    const hidden = await post(f, '/api/excel/preview', { ...id, sheet: '隐藏说明', range: 'A1:B3' })
    assert.equal('ready', hidden.status)
    const pdf = await fetch(f.base + '/api/excel/artifact?' + new URLSearchParams({ ...id, previewId: hidden.id, artifact: 'preview.pdf' }))
    assert.equal(200, pdf.status); assert.equal('application/pdf', pdf.headers.get('content-type'))
  }
  const followup = await post(f, '/api/chat', { sessionId, prompt: '回查隐藏说明' })
  assert.equal(1, followup.details.length); assert.equal('completed', followup.details[0].status)
  const other = await post(f, '/api/session/prepare', {})
  await post(f, '/api/excel/inspect', { ...id, sessionId: other.sessionId }, 403)
  await post(f, '/api/excel/delete', { ...id, sessionId: other.sessionId }, 403)
  const forbidden = await fetch(f.base + '/api/excel/inspect', { method: 'POST', headers: { Origin: 'https://untrusted.invalid', 'Content-Type': 'application/json' }, body: JSON.stringify(id) })
  assert.equal(403, forbidden.status)
  await f.close(); await f.boot()
  const history = await post(f, '/api/session/open', { sessionId })
  assert.ok(history.messages.some((message) => message.details?.some((detail) => detail.excel?.resultId === resultId)))
  assert.deepEqual(saved, await post(f, '/api/excel/result', { ...id, resultId }))
  const resumed = await post(f, '/api/chat', { sessionId, prompt: '回查隐藏说明' })
  assert.equal('completed', resumed.details[0].status)
  await post(f, '/api/excel/delete', id)
  await post(f, '/api/excel/inspect', id, 404)
  assert.equal('ready', (await post(f, '/api/excel/inspect', { sessionId, fileId: second.fileId })).file.status)
})
test('没有发送消息的草稿重启后仍可查阅和删除已上传附件', { timeout: 30000 }, async (t) => {
  const f = await nativeFixture(t), { sessionId } = await post(f, '/api/session/prepare', {})
  const file = await upload(f, sessionId), id = { sessionId, fileId: file.fileId }
  await f.close(); await f.boot()
  assert.equal('ready', (await post(f, '/api/excel/inspect', id)).file.status)
  await post(f, '/api/excel/delete', id)
  await post(f, '/api/excel/inspect', id, 404)
  assert.equal(0, f.received.length)
})

test('Linux 预览通过真实 DSH 图片附件传入当前视觉模型的供应商请求', {
  skip: process.platform !== 'linux' && !process.env.EXCEL_RENDER_WSL, timeout: 120000,
}, async (t) => {
  const f = await nativeFixture(t, true), { sessionId } = await post(f, '/api/session/prepare', {})
  const file = await upload(f, sessionId)
  const reply = await post(f, '/api/chat', { sessionId, prompt: '解析工作簿测试', workbooks: [file] })
  assertTools(reply)
  assert.ok(f.received.every((request) => request.model === 'excel-test'))
  const image = f.received.flatMap((request) => request.messages).flatMap((message) => Array.isArray(message.content) ? message.content : [])
    .find((block) => block.type === 'image_url')
  assert.ok(image?.image_url.url.startsWith('data:image/'))
  const original = await readFile(`${f.home}/excel-understanding/files/${file.fileId}/original`)
  assert.deepEqual(original, customerWorkbook())
})
