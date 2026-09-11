import XLSX from 'xlsx'
import { ExcelError, LIMITS } from './limits.js'

export function bounds(reference) {
  if (typeof reference !== 'string' || !/^[A-Z]{1,3}[1-9]\d{0,6}(?::[A-Z]{1,3}[1-9]\d{0,6})?$/.test(reference)) throw new ExcelError('请使用有效的 A1 单元格范围')
  const range = XLSX.utils.decode_range(reference)
  if (range.e.r < range.s.r || range.e.c < range.s.c || range.e.r >= 1048576 || range.e.c >= 16384) throw new ExcelError('单元格范围越界')
  return range
}
export const size = (range) => (range.e.r - range.s.r + 1) * (range.e.c - range.s.c + 1)
export const contains = (outer, inner) => outer.s.r <= inner.s.r && outer.s.c <= inner.s.c && outer.e.r >= inner.e.r && outer.e.c >= inner.e.c
export const intersects = (a, b) => a.s.r <= b.e.r && b.s.r <= a.e.r && a.s.c <= b.e.c && b.s.c <= a.e.c
export function sheetOf(index, name) {
  const sheet = index.sheets.find((item) => item.name === name)
  if (!sheet) throw new ExcelError('工作表不存在')
  return sheet
}
export function validRange(sheet, reference, limit = LIMITS.rangeCells) {
  const range = bounds(reference)
  if (!sheet.range || !contains(bounds(sheet.range), range)) throw new ExcelError('范围不在工作表内容区域内')
  if (size(range) > limit) throw new ExcelError(`范围超过 ${limit} 个单元格，请缩小区域`)
  if (!sheet.indexedRange || !contains(bounds(sheet.indexedRange), range)) throw new ExcelError('此区域未完成索引，请拆分原文件后重新上传')
  return range
}
export function cellsIn(sheet, reference) {
  const range = validRange(sheet, reference), cells = []
  for (let row = range.s.r; row <= range.e.r; row++) {
    for (let col = range.s.c; col <= range.e.c; col++) {
      const address = XLSX.utils.encode_cell({ r: row, c: col })
      cells.push(sheet.cells[address] ?? { address, type: 'z', raw: null, display: '', formula: null, cached: null })
    }
  }
  return cells
}
export function quoteOf(sheet, reference) {
  const range = validRange(sheet, reference), width = range.e.c - range.s.c + 1, cells = cellsIn(sheet, reference)
  return Array.from({ length: range.e.r - range.s.r + 1 }, (_, row) =>
    cells.slice(row * width, (row + 1) * width).map((cell) => cell.display).join('\t')).join('\n')
}
export function pageOf(sheet, requested, format) {
  const range = structuredClone(requested)
  range.e.c = Math.min(range.e.c, range.s.c + LIMITS.rangeCells - 1)
  const width = range.e.c - range.s.c + 1
  range.e.r = Math.min(range.e.r, range.s.r + Math.floor(LIMITS.rangeCells / width) - 1)
  for (;;) {
    const reference = XLSX.utils.encode_range(range), cells = cellsIn(sheet, reference)
    const result = format({ range, reference, cells })
    if (Buffer.byteLength(JSON.stringify(result)) <= LIMITS.responseBytes) return result
    if (range.e.r > range.s.r) range.e.r = range.s.r + Math.floor((range.e.r - range.s.r) / 2)
    else if (range.e.c > range.s.c) range.e.c = range.s.c + Math.floor((range.e.c - range.s.c) / 2)
    else throw new ExcelError('单个单元格及关联元数据超过完整响应限制；未记录为已读，请查阅原文件或拆分内容')
  }
}
