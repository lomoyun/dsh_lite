import XLSX from 'xlsx'
import { LIMITS, VERSION, ExcelError, checkInput } from './limits.js'
import { readZip } from './zip.js'
import { readObjects } from './ooxml.js'
import { csvWorkbook } from './csv.js'

function csvText(bytes, encoding = 'auto') {
  if (!['auto', 'utf-8', 'gb18030', 'utf-16le'].includes(encoding)) throw new ExcelError('CSV 编码无效')
  if (encoding !== 'auto') return new TextDecoder(encoding, { fatal: true }).decode(bytes)
  if (bytes[0] === 255 && bytes[1] === 254) return csvText(bytes, 'utf-16le')
  if (bytes[0] === 254 && bytes[1] === 255) return new TextDecoder('utf-16be', { fatal: true }).decode(bytes)
  try { return csvText(bytes, 'utf-8') } catch { return csvText(bytes, 'gb18030') }
}
function cellAt(address, cell) {
  return { address, type: cell.t ?? 'z', raw: cell.v ?? null, display: cell.w ?? XLSX.utils.format_cell(cell),
    formula: cell.f ?? null, cached: cell.f ? cell.v ?? null : null, format: cell.z ?? null,
    comments: (cell.c ?? []).map((comment) => ({ author: comment.a ?? '', text: comment.t ?? '' })),
    hyperlink: cell.l?.Target ?? null }
}
function regionsOf(cells) {
  const rows = new Map()
  for (const address of Object.keys(cells)) {
    const { r, c } = XLSX.utils.decode_cell(address), row = rows.get(r) ?? { min: c, max: c }
    row.min = Math.min(row.min, c); row.max = Math.max(row.max, c); rows.set(r, row)
  }
  const regions = []
  for (const [r, row] of [...rows].sort((a, b) => a[0] - b[0])) {
    const last = regions.at(-1)
    if (last && r === last.e.r + 1) { last.e.r = r; last.s.c = Math.min(last.s.c, row.min); last.e.c = Math.max(last.e.c, row.max) }
    else regions.push({ s: { r, c: row.min }, e: { r, c: row.max } })
  }
  return regions.map(XLSX.utils.encode_range)
}
function indexSheet(sheet, meta, budget) {
  const addresses = Object.keys(sheet).filter((key) => /^[A-Z]+[1-9]\d*$/.test(key))
  const cells = Object.create(null), range = sheet['!fullref'] ?? sheet['!ref'] ?? null
  let indexedRange = sheet['!ref'] ?? null
  // 单元格预算按完整行截断，避免把被截断单元格当成空白。
  const sorted = addresses.sort((a, b) => { const x = XLSX.utils.decode_cell(a), y = XLSX.utils.decode_cell(b); return x.r - y.r || x.c - y.c })
  const cutoff = sorted.length > budget.left ? XLSX.utils.decode_cell(sorted[budget.left]).r : Infinity
  for (const address of sorted) {
    if (XLSX.utils.decode_cell(address).r >= cutoff) break
    cells[address] = cellAt(address, sheet[address]); budget.left--
  }
  if (cutoff !== Infinity && indexedRange) {
    const r = XLSX.utils.decode_range(indexedRange); r.e.r = cutoff - 1
    indexedRange = r.e.r >= r.s.r ? XLSX.utils.encode_range(r) : null
  }
  const glyphs = Object.values(cells).filter((cell) => /[☑☐☒]/u.test(cell.display)).map((cell) => ({
    kind: 'checkbox', anchor: cell.address, basis: 'glyph', checked: null, text: cell.display, status: 'needs_visual_check' }))
  return { ...meta, range, indexedRange, complete: range === indexedRange, cells,
    cellCount: Object.keys(cells).length, regions: regionsOf(cells), merges: (sheet['!merges'] ?? []).map(XLSX.utils.encode_range),
    rows: sheet['!rows'] ?? [], columns: sheet['!cols'] ?? [], objects: [...meta.objects, ...glyphs] }
}
export function parseWorkbook(input) {
  const bytes = Buffer.from(input.bytes); checkInput({ ...input, bytes })
  const signature = bytes.subarray(0, 8).toString('hex')
  const format = signature.startsWith('504b0304') ? 'xlsx' : signature === 'd0cf11e0a1b11ae1' ? 'xls' : 'csv'
  if (format === 'csv' && !/\.csv$/i.test(input.name)) throw new ExcelError('文件内容与 Excel 格式不符')
  const objects = readObjects(format === 'xlsx' ? readZip(bytes) : null)
  const data = format === 'csv' ? csvText(bytes, input.encoding) : bytes
  if (typeof data === 'string' && (!data.trim() || data.includes('\0'))) throw new ExcelError('CSV 文本为空或编码不正确')
  const book = format === 'csv' ? csvWorkbook(data) : XLSX.read(data, { type: 'buffer',
    cellFormula: true, cellText: true, cellNF: true, cellStyles: true, cellHTML: false, sheetStubs: true,
    sheetRows: LIMITS.rows, bookVBA: false })
  if (book.SheetNames.length > LIMITS.sheets) throw new ExcelError('工作簿超过 256 个 Sheet，请拆分')
  const budget = { left: LIMITS.cells }, issues = [...objects.issues]
  const sheets = book.SheetNames.map((name, ordinal) => indexSheet(book.Sheets[name], {
    name, ordinal, hidden: book.Workbook?.Sheets?.[ordinal]?.Hidden ?? 0, objects: objects.sheets.get(name) ?? [],
  }, budget))
  for (const sheet of sheets) {
    for (const address of objects.formulasWithoutCache.get(sheet.name) ?? []) {
      if (sheet.cells[address]) Object.assign(sheet.cells[address], { raw: null, cached: null, display: '' })
    }
  }
  if (format === 'xls') issues.push({ code: 'legacy_objects', message: 'XLS 图片、控件、绘图对象无法完整索引，需查看原始预览。' })
  if (!input.name.toLowerCase().endsWith('.' + format)) issues.push({ code: 'format_mismatch', message: `已按实际内容识别为 ${format.toUpperCase()}` })
  if (sheets.some((sheet) => !sheet.complete)) issues.push({ code: 'index_limit', message: '达到索引限制，仅 indexedRange 范围可读取；其余区域未检查。' })
  return { schemaVersion: VERSION, format, sheets, issues, limits: LIMITS }
}
