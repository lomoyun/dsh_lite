import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, writeFile, mkdir, access, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ExcelService } from '../src/service.js'
import { digest } from '../src/store.js'
import { installTools } from '../src/tools.js'

const csv = Buffer.from('参数;值;单位\n型号;00123;\n流量;1,25;kg/s\n温度;;℃\n')
async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'excel-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const service = new ExcelService({ root, ...options }), sessionId = randomUUID()
  const { file } = await service.import({ sessionId, name: '同名.csv', bytes: csv })
  return { root, service, sessionId, fileId: file.fileId, file }
}
function understanding(fileId) {
  return { schemaVersion: 1, overview: '客户表包含型号、流量和空缺温度。',
    coverage: [{ sheet: 'Sheet1', purpose: '输入资料', ranges: ['A1:C4'] }],
    fields: [{ label: '流量', raw: '1,25', normalized: { kind: 'decimal_comma', value: 1.25 }, unit: 'kg/s',
      evidence: [{ fileId, sheet: 'Sheet1', range: 'B3', quote: '1,25' }, { fileId, sheet: 'Sheet1', range: 'C3', quote: 'kg/s' }] }],
    issues: [{ kind: 'missing', message: '温度未填写', evidence: [{ fileId, sheet: 'Sheet1', range: 'B4', quote: '' }] }] }
}
test('证据发布要求实际已读、原文和值匹配，规范化可重放；不将候选标成计算输入', async (t) => {
  const f = await fixture(t), input = { fileId: f.fileId, sessionId: f.sessionId }, data = understanding(f.fileId)
  await assert.rejects(f.service.publish({ ...input, understanding: data }), /尚未读取/)
  await f.service.read({ ...input, sheet: 'Sheet1', range: 'A1:C4' }, 'browser')
  await assert.rejects(f.service.publish({ ...input, understanding: data }), /尚未读取/)
  await f.service.read({ ...input, sheet: 'Sheet1', range: 'A1:C4' })
  for (const [change, expected] of [
    [(value) => { value.fields[0].evidence[0].quote = '1.25' }, /原文/],
    [(value) => { value.fields[0].raw = 1.25 }, /原始值/],
    [(value) => { value.fields[0].normalized.value = 125 }, /重放/],
    [(value) => { value.fields[0].evidence[0].range = 'B999' }, /范围/],
  ]) {
    const invalid = structuredClone(data); change(invalid)
    await assert.rejects(f.service.publish({ ...input, understanding: invalid }), expected)
  }
  const published = await f.service.publish({ ...input, understanding: data })
  const result = await f.service.result({ ...input, resultId: published.resultId })
  assert.equal('1,25', result.fields[0].raw)
  assert.equal(1.25, result.fields[0].normalized.value)
  assert.equal(false, result.validation.calculationReady)
  assert.ok(result.issues.some((issue) => issue.message.includes('未完成视觉核验')))
})
test('同名附件隔离，跨会话拒绝；服务重建可回查，删除清理产物且不影响其他文件', async (t) => {
  const f = await fixture(t)
  const second = await f.service.import({ sessionId: f.sessionId, name: f.file.name, bytes: csv })
  assert.notEqual(f.fileId, second.file.fileId)
  assert.equal(f.file.sha256, second.file.sha256)
  await assert.rejects(f.service.inspect({ fileId: f.fileId, sessionId: randomUUID() }), /不属于/)
  await assert.rejects(f.service.store.remove('../wrong', f.sessionId), /无效/)
  const resumed = new ExcelService({ root: f.root })
  assert.equal(2, (await resumed.store.list(f.sessionId)).length)
  assert.equal('00123', (await resumed.read({ fileId: f.fileId, sessionId: f.sessionId, sheet: 'Sheet1', range: 'B2' })).cells[0].raw)
  await resumed.store.remove(f.fileId, f.sessionId)
  await assert.rejects(access(join(f.root, f.fileId)), { code: 'ENOENT' })
  assert.equal(1, (await resumed.store.list(f.sessionId)).length)
})

test('通用发布定位原值/转换错误，定向修正后保留其他字段与原错误码', async t => {
  const f = await fixture(t), input = { fileId: f.fileId, sessionId: f.sessionId }
  await f.service.read({ ...input, sheet: 'Sheet1', range: 'A1:C4' })
  const data = understanding(f.fileId)
  data.fields.unshift({ label: '型号', raw: '00123', evidence: [{ fileId: f.fileId, sheet: 'Sheet1', range: 'B2', quote: '00123' }] })
  for (const [change, path, reason, expected] of [
    [f => { f.raw = 1.25 }, 'raw', /原始值/, { expectedRaw: '1,25', receivedRaw: 1.25 }],
    [f => { f.normalized.kind = 'number' }, 'normalized', /转换不明确/, { raw: '1,25' }],
    [f => { f.normalized.value = 125 }, 'normalized.value', /无法从原值重放/, { expectedValue: 1.25, receivedValue: 125 }],
  ]) {
    const invalid = structuredClone(data); change(invalid.fields[1])
    await assert.rejects(f.service.publish({ ...input, understanding: invalid }), error => {
      assert.equal(error.code, 'EXCEL_INVALID'); assert.equal(error.status, 400)
      const d = JSON.parse(error.message)
      assert.equal(d.fieldLabel, '流量'); assert.equal(d.fieldPath, `fields[1].${path}`)
      assert.equal(d.sourcePath, 'fields[1].evidence[0]'); assert.equal(d.fileId, f.fileId)
      assert.equal(d.sheet, 'Sheet1'); assert.equal(d.range, 'B3'); assert.match(d.reason, reason)
      for (const [key, value] of Object.entries(expected)) assert.equal(d[key], value)
      return true
    })
    invalid.fields[1] = structuredClone(data.fields[1])
    const saved = await f.service.publish({ ...input, understanding: invalid })
    const result = await f.service.result({ ...input, resultId: saved.resultId })
    assert.equal(result.fields[0].raw, '00123'); assert.equal(result.fields[1].normalized.value, 1.25)
  }
  const invalidQuote = structuredClone(data); invalidQuote.fields[1].evidence[1].quote = 'kg/h'
  await assert.rejects(f.service.publish({ ...input, understanding: invalidQuote }), error => {
    const d = JSON.parse(error.message)
    assert.equal(d.kind, 'EXCEL_QUOTE_MISMATCH'); assert.equal(d.fieldLabel, '流量')
    assert.equal(d.sourcePath, 'fields[1].evidence[1]'); assert.equal(d.range, 'C3'); assert.equal(d.expectedQuote, 'kg/s')
    return true
  })
})
test('解析失败保留原件和错误；索引/原件摘要异常时拒绝继续使用', async (t) => {
  const f = await fixture(t)
  const broken = await f.service.import({ sessionId: f.sessionId, name: '损坏.xlsx', bytes: Buffer.from('broken') })
  assert.equal('failed', broken.file.status)
  const info = await f.service.inspect({ fileId: broken.file.fileId, sessionId: f.sessionId })
  assert.equal('parse_failed', info.issues[0].code)
  assert.equal('broken', (await f.service.artifact({ fileId: broken.file.fileId, sessionId: f.sessionId, artifact: 'original' })).bytes.toString())
  await writeFile(join(f.root, f.fileId, 'index.json'), '{}')
  await assert.rejects(f.service.read({ fileId: f.fileId, sessionId: f.sessionId, sheet: 'Sheet1', range: 'A1' }), /摘要/)
})
test('大表分页返回实际覆盖范围；搜索游标不遗漏、文本按字面搜索', async (t) => {
  const f = await fixture(t), bytes = Buffer.from(Array.from({ length: 2500 }, (_, i) => `字段,${i}`).join('\n'))
  const { file } = await f.service.import({ sessionId: f.sessionId, name: '大表.csv', bytes })
  const input = { fileId: file.fileId, sessionId: f.sessionId }
  const first = await f.service.read({ ...input, sheet: 'Sheet1', range: 'A1:B2500' })
  assert.equal(true, first.partial); assert.match(first.returnedRange, /^A1:B\d+$/)
  assert.ok(first.cells.length <= 2000); assert.ok(Buffer.byteLength(JSON.stringify(first.cells)) <= 64000)
  const search = await f.service.search({ ...input, query: '字段' })
  assert.equal(100, search.matches.length)
  const next = await f.service.search({ ...input, query: '字段', offset: search.nextOffset })
  assert.equal('A101', next.matches[0].address)
  assert.equal(0, (await f.service.search({ ...input, query: '.*' })).matches.length)
})
test('预览失败可继续结构理解，文本模型不换模型；图片能力使用 DSH attachment 输出', async (t) => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=', 'base64')
  let saves = 0, modality = ['text']
  const ctx = { llm: { resolveModelInfo: async () => ({ inputModalities: modality }) }, attachments: {
    saveImage: async ({ data }) => { saves++; assert.deepEqual(png, data); return { attachmentId: 'test-image', mediaType: 'image/png', width: 1, height: 1, bytes: data.length } },
  } }
  const f = await fixture(t, { ctx, render: async () => { throw new Error('渲染依赖缺失') } })
  const input = { fileId: f.fileId, sessionId: f.sessionId, sheet: 'Sheet1' }, agent = { id: f.sessionId, options: { provider: 'same', model: 'same' } }
  assert.equal('unavailable', (await f.service.preview(input, agent)).status)
  assert.equal(1, (await f.service.read({ ...input, range: 'B2' })).cells.length)
  f.service.render = async ({ directory, sheet }) => {
    const id = randomUUID(), output = join(directory, 'previews', id, 'output'); await mkdir(output, { recursive: true })
    await writeFile(join(output, 'page-1.png'), png)
    return { id, sheet, range: null, status: 'ready', pages: [{ page: 1, filename: 'page-1.png', sha256: digest(png) }] }
  }
  const textOnly = await f.service.preview(input, agent)
  assert.equal('model_not_vision_capable', textOnly.visualStatus); assert.equal(0, saves)
  modality = ['text', 'image']
  const tools = []; ctx.tools = { register: (tool) => tools.push(tool) }; installTools(ctx, f.service)
  const tool = tools.find((tool) => tool.name === 'excel_preview')
  const value = await tool.execute({ fileId: f.fileId, sheet: 'Sheet1' }, { agent })
  const meta = tool.output.presentationMeta({}, value)
  assert.deepEqual(meta, JSON.parse(JSON.stringify(meta)))
  assert.equal(1, saves); assert.equal('image', tool.output.render({}, value)[1].type)
  assert.equal('same', agent.options.model)
  await f.service.read({ ...input, range: 'A1:C4' })
  const data = understanding(f.fileId), previewId = JSON.parse(value).id
  data.observations = [{ fileId: f.fileId, sheet: 'Sheet1', previewId, page: 1, region: [0, 0, 0.5, 0.5], observation: '模型认为左上方是表头' }]
  const observed = await f.service.publish({ ...input, understanding: data })
  const result = await f.service.result({ ...input, resultId: observed.resultId })
  assert.equal('model_observation_unproven', result.observations[0].validation)
  assert.equal(1, result.coverage[0].visualObservations.length)
  data.observations[0].page = 2
  await assert.rejects(f.service.publish({ ...input, understanding: data }), /未向模型提供/)
  await assert.rejects(tool.execute({ fileId: f.fileId, sheet: 'Sheet1' }, { agent: { ...agent, id: randomUUID() } }), /不属于/)
})
