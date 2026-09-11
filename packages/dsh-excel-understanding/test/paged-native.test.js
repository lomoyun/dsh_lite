import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { nativeFixture, post } from './native-fixture.js'
import { denseWorkbook, pagedModel, SHEET } from './paged-model.js'

async function runCase(t, input) {
  const f = await nativeFixture(t, false, { respond: pagedModel, contextWindow: 262144, env: { EXCEL_RENDER_WSL: '' } })
  const { sessionId } = await post(f, '/api/session/prepare', {})
  const upload = await fetch(f.base + '/api/excel/upload', { method: 'POST', body: input.bytes,
    headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': input.name, 'X-Session-Id': sessionId } })
  assert.equal(200, upload.status)
  const { file } = await upload.json(), id = { fileId: file.fileId, sessionId }
  const reply = await post(f, '/api/chat', { sessionId, prompt: '分页核对蒸发器参数', workbooks: [file] })
  const failed = reply.details.filter((detail) => detail.status === 'failed')
  assert.equal(2, failed.length); assert.match(failed[0].text, /EXCEL_COVERAGE_INCOMPLETE/)
  assert.match(failed[1].text, /EXCEL_QUOTE_MISMATCH/); assert.match(failed[1].text, /issues\[0\]\.evidence\[0\]/)
  assert.equal('completed', reply.details.at(-1).status)
  const reads = f.received.at(-1).messages.filter((message) => message.role === 'tool').flatMap((message) => {
    const text = typeof message.content === 'string' ? message.content : message.content.map((block) => block.text ?? '').join('')
    if (text.startsWith('Error:')) return []
    const value = JSON.parse(text)
    if (value.readVersion !== 2) return []
    assert.ok(Buffer.byteLength(text) <= 32000); assert.doesNotMatch(text, /Omitted \d+ bytes/)
    return [value]
  })
  assert.ok(reads.length > 1)
  const resultId = reply.details.at(-1).excel.resultId, result = await post(f, '/api/excel/result', { ...id, resultId })
  assert.equal(10, result.fields[0].raw); assert.equal('D33', result.fields[0].evidence[0].range)
  assert.deepEqual(['A1:N74'], result.coverage.find((item) => item.sheet === SHEET).understoodRanges)
  if (process.platform === 'win32') assert.ok(result.issues.some((item) => item.message.includes('未完成视觉核验')))
  await f.close(); await f.boot()
  assert.deepEqual(result, await post(f, '/api/excel/result', { ...id, resultId }))
  t.diagnostic(`${input.name}: ${reads.length} 个完整读取响应；故意发布失败后补读成功，重启结果一致`)
}
test('真实 DSH：密集表跨页完整返回、发布缺口恢复、视觉不可用时仍可保存', { timeout: 120000 }, async (t) => {
  await runCase(t, { name: 'dense.xlsx', bytes: denseWorkbook() })
})
test('真实客户蒸发器表：D33 原值和来源、完整响应、恢复与持久化', {
  timeout: 120000, skip: !process.env.EXCEL_REGRESSION_FILE,
}, async (t) => {
  await runCase(t, { name: 'customer.xls', bytes: await readFile(process.env.EXCEL_REGRESSION_FILE) })
})
