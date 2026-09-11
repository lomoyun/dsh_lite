import { randomUUID } from 'node:crypto'
import { ExcelError, VERSION, LIMITS } from './limits.js'
import { sheetOf, validRange, quoteOf, cellsIn } from './ranges.js'
import { missingRanges, requireRead, confirmedReads } from './read-coverage.js'

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const objectNames = { image: '图片', drawing: '绘图', checkbox: '勾选信息', legacy_drawing: '旧式绘图或批注',
  control: '控件', oleObject: '嵌入对象', external_link: '外部链接' }
function text(value, name, max = 4000) {
  if (typeof value !== 'string' || value.length > max) throw new ExcelError(`${name} 必须是长度不超限的文本`)
  return value
}
function list(value, name, max = LIMITS.fields) {
  if (!Array.isArray(value) || value.length > max) throw new ExcelError(`${name} 必须是长度不超限的列表`)
  return value
}
export function wasRead(state, sheet, range) {
  return missingRanges(state, sheet, range).length === 0
}
function requireQuote(source, sheet, sourcePath) {
  const expectedQuote = quoteOf(sheet, source.range)
  if (source.quote === expectedQuote) return
  const diagnostic = { kind: 'EXCEL_QUOTE_MISMATCH', fileId: source.fileId, sheet: sheet.name, range: source.range, sourcePath,
    instruction: '证据原文与来源不一致。请回查该坐标，精确复制显示原文；多格以制表符和换行连接。仅引用标题时缩小坐标。环境或预览不可用的说明可不附单元格证据。' }
  const quoteByteLimit = 8000
  if (Buffer.byteLength(expectedQuote) <= quoteByteLimit) diagnostic.expectedQuote = expectedQuote
  throw new ExcelError(JSON.stringify(diagnostic))
}
function evidenceOf(source, context, sourcePath) {
  const { meta, index, state } = context
  if (!source || source.fileId !== meta.fileId) throw new ExcelError('证据文件与当前工作簿不一致')
  const sheet = sheetOf(index, source.sheet)
  if (source.previewId) {
    const preview = state.previews.find((item) => item.id === source.previewId && item.sheet === source.sheet && item.status === 'ready')
    if (!preview?.deliveredPages?.includes(source.page) || !Number.isInteger(source.page)) throw new ExcelError('图片证据未向模型提供或页面无效')
    if (!Array.isArray(source.region) || source.region.length !== 4 || source.region.some((n) => !Number.isFinite(n) || n < 0 || n > 1) || source.region[0] >= source.region[2] || source.region[1] >= source.region[3]) throw new ExcelError('图片区域应为归一化的 [左,上,右,下]')
    return { fileId: meta.fileId, sheet: sheet.name, previewId: preview.id, page: source.page, region: source.region,
      observation: text(source.observation, '视觉观察'), validation: 'model_observation_unproven' }
  }
  validRange(sheet, source.range)
  requireRead(context, sheet.name, source.range)
  requireQuote(source, sheet, sourcePath)
  return { fileId: meta.fileId, sheet: sheet.name, range: source.range, quote: source.quote, validation: 'exact_source_match' }
}
function normalize(raw, conversion) {
  if (!conversion || !['identity', 'trim', 'decimal_comma', 'number'].includes(conversion.kind)) throw new ExcelError('规范化必须声明支持的转换：identity、trim、decimal_comma、number')
  if (conversion.kind === 'identity') return raw
  if (conversion.kind === 'trim') { if (typeof raw !== 'string') throw new ExcelError('trim 来源必须为文本'); return raw.trim() }
  const value = String(raw ?? '').trim(), pattern = conversion.kind === 'decimal_comma' ? /^[+-]?\d+,\d+$/ : /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/
  if (!pattern.test(value)) throw new ExcelError('数值转换不明确，请保留原值并列为待核对项')
  const number = Number(conversion.kind === 'decimal_comma' ? value.replace(',', '.') : value)
  if (!Number.isFinite(number)) throw new ExcelError('规范化结果不是有限数值')
  return number
}
function diagnosticValue(value) {
  const encoded = JSON.stringify(value)
  return encoded && Buffer.byteLength(encoded) > 4000 ? { truncated: true, preview: encoded.slice(0, 800) } : value
}
function fieldFailure(field, sourcePath, source, property, reason, details = {}) {
  throw new ExcelError(JSON.stringify({ fieldLabel: field.label, fieldPath: `${sourcePath}.${property}`,
    sourcePath: `${sourcePath}.evidence[${field.valueEvidence ?? 0}]`,
    fileId: source?.fileId, sheet: source?.sheet, range: source?.range, reason, ...details,
    instruction: '按字段路径和来源坐标定向修正，保留其他已核验字段。无法明确转换时保留 raw，去掉 normalized 并列为待核对项；重试须有新证据或明确修正。' }))
}
function fieldOf(field, context, sourcePath) {
  const evidence = list(field.evidence, '字段证据', 20).map((source, i) => evidenceOf(source, context, `${sourcePath}.evidence[${i}]`))
  if (!evidence.length) throw new ExcelError('字段缺少证据')
  const valueEvidence = evidence[field.valueEvidence ?? 0]
  if (!valueEvidence?.range || valueEvidence.range.includes(':')) fieldFailure(field, sourcePath, valueEvidence, 'valueEvidence', '原始值必须引用单个单元格；图片观察请写入 observations')
  const cell = cellsIn(sheetOf(context.index, valueEvidence.sheet), valueEvidence.range)[0]
  if (!same(cell.raw, field.raw)) fieldFailure(field, sourcePath, valueEvidence, 'raw', '字段原始值与来源不一致',
    { expectedRaw: diagnosticValue(cell.raw), receivedRaw: diagnosticValue(field.raw) })
  const normalized = field.normalized === undefined ? null : field.normalized
  if (normalized) {
    let expected
    try { expected = normalize(cell.raw, normalized) }
    catch (error) {
      if (!(error instanceof ExcelError)) throw error
      fieldFailure(field, sourcePath, valueEvidence, 'normalized', error.message, { raw: diagnosticValue(cell.raw), conversion: diagnosticValue(normalized) })
    }
    if (!same(expected, normalized.value)) fieldFailure(field, sourcePath, valueEvidence, 'normalized.value', '规范化候选值无法从原值重放',
      { expectedValue: diagnosticValue(expected), receivedValue: diagnosticValue(normalized.value), conversionKind: normalized.kind })
  }
  return { label: text(field.label, '字段名', 200), explanation: text(field.explanation ?? '', '字段解释'),
    raw: cell.raw, normalized, unit: text(field.unit ?? '', '单位候选', 80), evidence,
    status: 'candidate', semanticValidation: 'requires_confirmation' }
}
function checkedField(field, context, sourcePath) {
  try { return fieldOf(field, context, sourcePath) }
  catch (error) {
    if (!(error instanceof ExcelError)) throw error
    // Retain existing error codes and structured quote/read diagnostics.
    let diagnostic
    try { diagnostic = JSON.parse(error.message) } catch { diagnostic = { reason: error.message } }
    const source = field.evidence?.[field.valueEvidence ?? 0]
    error.message = JSON.stringify({ fieldLabel: field.label, fieldPath: sourcePath,
      fileId: source?.fileId, sheet: source?.sheet, range: source?.range, ...diagnostic })
    throw error
  }
}
function coverageOf(input, context) {
  const claims = list(input, 'Sheet 理解范围', LIMITS.sheets)
  for (const claim of claims) {
    const sheet = sheetOf(context.index, claim.sheet)
    list(claim.ranges, '理解范围').forEach((range) => {
      validRange(sheet, range, Infinity)
      requireRead(context, sheet.name, range)
    })
  }
  return context.index.sheets.map((sheet) => ({ sheet: sheet.name, hidden: sheet.hidden,
    indexedRange: sheet.indexedRange, indexComplete: sheet.complete,
    readRanges: confirmedReads(context.state, sheet.name).map((read) => read.range),
    understoodRanges: [...new Set(claims.filter((claim) => claim.sheet === sheet.name).flatMap((claim) => claim.ranges))],
    purpose: text(claims.find((claim) => claim.sheet === sheet.name)?.purpose ?? '', 'Sheet 用途'),
    visualPreviews: context.state.previews.filter((p) => p.sheet === sheet.name).map((p) => ({ id: p.id, range: p.range,
      status: p.status, deliveredToModel: Boolean(p.deliveredToModel), verified: false })),
  }))
}
export function validateUnderstanding(input, context) {
  if (!input || input.schemaVersion !== VERSION || Buffer.byteLength(JSON.stringify(input)) > LIMITS.resultBytes) throw new ExcelError('理解结果版本无效或内容过大')
  const coverage = coverageOf(input.coverage, context)
  const fields = list(input.fields, '字段').map((field, i) => checkedField(field, context, `fields[${i}]`))
  const observations = list(input.observations ?? [], '观察').map((source, i) => evidenceOf(source, context, `observations[${i}]`))
  const issues = list(input.issues, '待核对项').map((item, i) => ({ kind: text(item.kind, '问题类型', 80), message: text(item.message, '问题说明'),
    evidence: list(item.evidence ?? [], '问题证据', 20).map((source, j) => evidenceOf(source, context, `issues[${i}].evidence[${j}]`)) }))
  const automatic = coverage.flatMap((sheet) => [
    { kind: 'coverage', message: `${sheet.sheet}：已声明理解的范围为 ${sheet.understoodRanges.join('、') || '无'}；其余区域尚未声明理解。` },
    { kind: 'visual', message: `${sheet.sheet}：${sheet.visualPreviews.some((p) => p.deliveredToModel) ? '已提供预览，视觉结论仍为模型观察' : '未完成视觉核验'}` },
  ])
  for (const sheet of coverage) sheet.visualObservations = observations.filter((source) => source.sheet === sheet.sheet && source.previewId)
  for (const sheet of context.index.sheets) {
    for (const object of sheet.objects) automatic.push({ kind: 'object_review', message: `${sheet.name} ${object.anchor ?? '位置未知'}：${objectNames[object.kind] ?? '扩展对象'}，需核对。` })
  }
  return { schemaVersion: VERSION, resultId: randomUUID(), fileId: context.meta.fileId, sha256: context.meta.sha256,
    createdAt: new Date().toISOString(), overview: text(input.overview, '概览'), coverage, fields, observations,
    issues: [...issues, ...context.index.issues.map((issue) => ({ kind: issue.code, message: issue.message })), ...automatic],
    validation: { evidence: 'checked', semantics: 'model_inference', calculationReady: false },
    source: { kind: 'excel-workbook', fileId: context.meta.fileId, sha256: context.meta.sha256 } }
}
