import XLSX from 'xlsx'
import { TABLE_LIMITS, normalizeTables, tableFromGrid } from '../public/table-data.js'
import { delimiterOf, parseDelimited } from '../public/table-format.js'

const ZIP_END = 0x06054b50
const ZIP_ENTRY = 0x02014b50
const MAX_EXPANDED_BYTES = 32 * 1024 * 1024
const MAX_ZIP_ENTRIES = 2048
const CFB_MAGIC = 'd0cf11e0a1b11ae1'

function zipDirectory(bytes) {
  const minimum = Math.max(0, bytes.length - 65557)
  for (let index = bytes.length - 22; index >= minimum; index--) {
    if (bytes.readUInt32LE(index) !== ZIP_END) continue
    const count = bytes.readUInt16LE(index + 10)
    const start = bytes.readUInt32LE(index + 16)
    if (!count || count > MAX_ZIP_ENTRIES || start >= index) break
    return { count, start }
  }
  throw new Error('Excel 压缩结构无效或文件内容过大')
}

function inspectZip(bytes) {
  const { count, start } = zipDirectory(bytes)
  let offset = start, expanded = 0
  for (let index = 0; index < count; index++) {
    if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== ZIP_ENTRY) throw new Error('Excel 文件格式不完整')
    if (bytes.readUInt16LE(offset + 8) & 1) throw new Error('请先解除 Excel 文件密码保护')
    expanded += bytes.readUInt32LE(offset + 24)
    if (expanded > MAX_EXPANDED_BYTES) throw new Error('Excel 解压后的内容过大，请拆分工作簿')
    offset += 46 + bytes.readUInt16LE(offset + 28) + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32)
  }
}

function csvText(bytes, encoding) {
  if (!['auto', 'utf-8', 'gb18030', 'utf-16le'].includes(encoding)) throw new Error('CSV 编码选项无效')
  if (encoding !== 'auto') return { text: new TextDecoder(encoding, { fatal: true }).decode(bytes), warnings: [] }
  if (bytes[0] === 255 && bytes[1] === 254) return csvText(bytes, 'utf-16le')
  if (bytes[0] === 254 && bytes[1] === 255) return { text: new TextDecoder('utf-16be', { fatal: true }).decode(bytes), warnings: [] }
  try { return csvText(bytes, 'utf-8') }
  catch { return { ...csvText(bytes, 'gb18030'), warnings: ['CSV 已按 GB18030 解码，请核对中文内容。'] } }
}

function parseCsv(bytes, name, encoding) {
  const { text, warnings } = csvText(bytes, encoding)
  if (!text.trim()) throw new Error('CSV 文件为空')
  if (text.includes('\0')) throw new Error('CSV 包含无效字符，请选择正确的编码')
  return [tableFromGrid(parseDelimited(text, delimiterOf(text)), { title: name, source: name, warnings })]
}

function sheetRange(sheet) {
  const reference = sheet['!fullref'] ?? sheet['!ref']
  if (!reference) return null
  const range = XLSX.utils.decode_range(reference)
  if (range.e.r - range.s.r > TABLE_LIMITS.rows) throw new Error(`工作表超过 ${TABLE_LIMITS.rows} 行数据，请拆分后导入`)
  if (range.e.c - range.s.c >= TABLE_LIMITS.columns) throw new Error(`工作表超过 ${TABLE_LIMITS.columns} 列，请拆分后导入`)
  return range
}

function readSheet(sheet, meta) {
  const range = sheetRange(sheet)
  if (!range) return null
  const warnings = [...meta.warnings]
  let hasFormula = false
  const grid = Array.from({ length: range.e.r - range.s.r + 1 }, (_, row) =>
    Array.from({ length: range.e.c - range.s.c + 1 }, (_, column) => {
      const cell = sheet[XLSX.utils.encode_cell({ r: row + range.s.r, c: column + range.s.c })]
      if (cell?.f) { hasFormula = true; return `=${cell.f}` }
      return cell ? XLSX.utils.format_cell(cell) : ''
    }))
  if (hasFormula) warnings.push('公式按原式保留为文本，未执行计算。')
  if (sheet['!merges']?.length) warnings.push('合并单元格保留左上角内容，其他位置留空。')
  return tableFromGrid(grid, { ...meta, warnings })
}

function parseExcel(bytes, name, extension) {
  const zipped = bytes.subarray(0, 4).toString('hex') === '504b0304'
  const legacy = bytes.subarray(0, 8).toString('hex') === CFB_MAGIC
  if ((extension === 'xlsx' && !zipped) || (extension === 'xls' && !legacy)) throw new Error('文件内容与 Excel 扩展名不匹配，请重新导出')
  if (zipped) inspectZip(bytes)
  const book = XLSX.read(bytes, { type: 'buffer', cellFormula: true, cellHTML: false,
    cellText: true, sheetRows: TABLE_LIMITS.rows + 2, bookVBA: false })
  if (book.SheetNames.length > TABLE_LIMITS.tables) throw new Error(`每个文件最多 ${TABLE_LIMITS.tables} 个工作表，请拆分文件`)
  return book.SheetNames.map((title, index) => {
    const warnings = book.Workbook?.Sheets?.[index]?.Hidden ? ['此工作表在原文件中为隐藏状态。'] : []
    return readSheet(book.Sheets[title], { title, source: `${name} / ${title}`, warnings })
  }).filter(Boolean)
}

function detectFormat(buffer, extension) {
  if (buffer.subarray(0, 4).toString('hex') === '504b0304') return 'xlsx'
  if (buffer.subarray(0, 8).toString('hex') === CFB_MAGIC) return 'xls'
  if (extension === 'csv') return 'csv'
  throw new Error('文件内容与 Excel 扩展名不匹配，请重新导出')
}

function workbookInput(name, bytes) {
  if (typeof name !== 'string' || !name || name.length > 120 || /[/\\\0]/.test(name)) throw new Error('文件名无效或过长')
  const buffer = Buffer.from(bytes)
  if (!buffer.length) throw new Error('文件为空')
  if (buffer.length > TABLE_LIMITS.fileBytes) throw new Error('文件超过 5 MB，请拆分后上传')
  const extension = name.split('.').at(-1).toLowerCase()
  if (!['xlsx', 'xls', 'csv'].includes(extension)) throw new Error('请选择 .xlsx、.xls 或 .csv 文件')
  return { buffer, extension }
}

export function parseWorkbook({ name, bytes, encoding = 'auto' }) {
  const { buffer, extension } = workbookInput(name, bytes)
  const format = detectFormat(buffer, extension)
  const tables = format === 'csv' ? parseCsv(buffer, name, encoding) : parseExcel(buffer, name, format)
  if (!tables.length) throw new Error('文件没有可读取的表格')
  if (format !== extension) tables[0].warnings.push(`已按实际内容识别为 ${format.toUpperCase()}，与文件扩展名不一致，请核对。`)
  return { tables: normalizeTables(tables) }
}
