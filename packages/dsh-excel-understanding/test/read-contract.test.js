import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ExcelService } from '../src/service.js'
import { wasRead } from '../src/understanding.js'
import { installTools } from '../src/tools.js'

const sheet = 'Sheet1'
const confirmed = (range) => ({ sheet, range, version: 2 })
async function fixture(t, bytes) {
  const root = await mkdtemp(join(tmpdir(), 'excel-contract-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const service = new ExcelService({ root }), sessionId = randomUUID()
  const { file } = await service.import({ sessionId, name: 'data.csv', bytes })
  return { service, sessionId, fileId: file.fileId, sheet }
}
test('跨页并集必须逐格覆盖；行列缺口、其他 Sheet 和旧记录不能通过', () => {
  assert.equal(true, wasRead({ reads: ['A1:N19', 'A20:N47', 'A48:N74'].map(confirmed) }, sheet, 'A1:N74'))
  assert.equal(true, wasRead({ reads: ['A1:B4', 'C1:D2', 'C3:D4'].map(confirmed) }, sheet, 'A1:D4'))
  assert.equal(false, wasRead({ reads: ['A1:B4', 'C1:D2', 'C4:D4'].map(confirmed) }, sheet, 'A1:D4'))
  assert.equal(false, wasRead({ reads: [{ sheet, range: 'A1:N74' }] }, sheet, 'A1:N74'))
  assert.equal(false, wasRead({ reads: [confirmed('A1:N74')] }, 'other', 'A1:N74'))
})
test('完整响应包括原文和元数据应在 32 KB 内；剩余区域可继续读取', async (t) => {
  const bytes = Buffer.from(Array.from({ length: 200 }, (_, row) => Array.from({ length: 14 }, (_, col) => `参数_${row}_${col}_客户资料`).join(',')).join('\n'))
  const f = await fixture(t, bytes), result = await f.service.read({ ...f, range: 'A1:N200' })
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 32000)
  assert.ok(result.nextRanges.length)
})
test('超大单格返回明确错误，不能留下已读记录', async (t) => {
  const f = await fixture(t, Buffer.from('A'.repeat(20000)))
  await assert.rejects(f.service.read({ ...f, range: 'A1' }), /超过.*限制/)
  assert.equal(0, (await f.service.inspect(f)).sheets[0].readRanges.length)
})

test('分页后可只定向补当前字段证据，局部发布通过而整表声明仍拒绝', async t => {
  const bytes = Buffer.from(Array.from({ length: 800 }, (_, i) => `field_${i},${i}`).join('\n'))
  const f = await fixture(t, bytes)
  const first = await f.service.read({ ...f, range: 'A1:B800' })
  assert.equal(first.partial, true)
  const found = await f.service.search({ ...f, query: 'field_799' })
  assert.equal(found.matches[0].address, 'A800')
  await f.service.read({ ...f, range: 'A800:B800' })
  const data = { schemaVersion: 1, overview: '仅核对指定字段', coverage: [{ sheet, ranges: ['A800:B800'] }],
    fields: [{ label: 'field_799', raw: '799', evidence: [{ fileId: f.fileId, sheet, range: 'B800', quote: '799' }] }], issues: [] }
  assert.ok((await f.service.publish({ ...f, understanding: data })).resultId)
  data.coverage[0].ranges = ['A1:B800']
  await assert.rejects(f.service.publish({ ...f, understanding: data }), /EXCEL_COVERAGE_INCOMPLETE/)
})
test('工具执行尚不等于内容完整送达；旧记录须重新读取', async (t) => {
  const f = await fixture(t, Buffer.from('name,value\nflow,10'))
  const registered = [], agent = { id: f.sessionId, session: { snapshotEvents: () => [] } }
  installTools({ tools: { register: (tool) => registered.push(tool) } }, f.service)
  await registered.find((tool) => tool.name === 'excel_read_range').execute({ fileId: f.fileId, sheet, range: 'A1:B2' }, { agent })
  assert.equal(0, (await f.service.inspect(f)).sheets[0].readRanges.length)
})

test('待核对项引用整表却只引用标题时，返回准确路径与原文供修正', async (t) => {
  const f = await fixture(t, Buffer.from('name,value\nflow,10'))
  await f.service.read({ ...f, range: 'A1:B2' })
  const evidence = { fileId: f.fileId, sheet, range: 'A1:B2', quote: 'name' }
  const data = { schemaVersion: 1, overview: 'test', coverage: [{ sheet, ranges: ['A1:B2'] }], fields: [],
    issues: [{ kind: 'unchecked', message: '待核对', evidence: [evidence] }] }
  await assert.rejects(f.service.publish({ ...f, understanding: data }), (error) => {
    const diagnostic = JSON.parse(error.message)
    assert.equal('EXCEL_QUOTE_MISMATCH', diagnostic.kind)
    assert.equal('issues[0].evidence[0]', diagnostic.sourcePath)
    assert.equal('A1:B2', diagnostic.range)
    assert.equal('name\tvalue\nflow\t10', diagnostic.expectedQuote)
    return true
  })
  evidence.range = 'A1'
  assert.ok((await f.service.publish({ ...f, understanding: data })).resultId)
})

test('被宿主截断的结果不确认；完整重读可发布并在重启后保留', async (t) => {
  const f = await fixture(t, Buffer.from('name,value\nflow,10'))
  await f.service.store.update(f.fileId, f.sessionId, ({ state }) => state.reads.push({ sheet, range: 'A1:B2' }))
  const tools = [], events = [], agent = { id: f.sessionId, session: { snapshotEvents: () => events } }
  installTools({ tools: { register: (tool) => tools.push(tool) } }, f.service)
  const read = tools.find((tool) => tool.name === 'excel_read_range'), inspect = tools.find((tool) => tool.name === 'excel_inspect')
  const args = { fileId: f.fileId, sheet, range: 'A1:B2' }, value = await read.execute(args, { agent })
  const event = (id, text) => [
    { type: 'tool/call', data: { callId: id, name: 'excel_read_range' } },
    { type: 'tool/result', data: { message: { content: [{ type: 'tool-result', toolCallId: id, content: [{ type: 'text', text }] }] } } },
  ]
  events.push(...event('truncated', value.slice(0, 100) + '\n(Omitted bytes)'))
  assert.equal(0, JSON.parse(await inspect.execute(args, { agent })).sheets[0].readRanges.length)
  const data = { schemaVersion: 1, overview: 'test', coverage: [{ sheet, purpose: 'test', ranges: ['A1:B2'] }], fields: [], issues: [] }
  await assert.rejects(f.service.publish({ ...f, understanding: data }), (error) => {
    const diagnostic = JSON.parse(error.message)
    assert.equal('EXCEL_COVERAGE_INCOMPLETE', diagnostic.kind)
    assert.deepEqual(['A1:B2'], diagnostic.missingRanges)
    return true
  })
  events.push(...event('complete', value))
  await inspect.execute(args, { agent })
  const restored = new ExcelService({ root: f.service.store.root })
  const published = await restored.publish({ ...f, understanding: data })
  assert.ok(published.resultId)
  assert.deepEqual(['A1:B2'], (await restored.inspect(f)).sheets[0].readRanges)
})
