import XLSX from 'xlsx'
import { LIMITS, ExcelError } from './limits.js'

function delimiterOf(text) {
  const counts = new Map([[',', 0], [';', 0], ['\t', 0]])
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"') { if (quoted && text[i + 1] === '"') i++; else quoted = !quoted }
    if (!quoted && (ch === '\n' || ch === '\r')) break
    if (!quoted && counts.has(ch)) counts.set(ch, counts.get(ch) + 1)
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0][0]
}
function* rowsOf(text, delimiter) {
  let row = [], field = '', quoted = false, closed = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch !== '"') field += ch
      else if (text[i + 1] === '"') { field += '"'; i++ }
      else { quoted = false; closed = true }
      continue
    }
    if (ch === '"') {
      if (field || closed) throw new ExcelError('CSV 引号位置无效')
      quoted = true; continue
    }
    if (ch === delimiter || ch === '\r' || ch === '\n') {
      row.push(field); field = ''; closed = false
      if (ch === delimiter) continue
      if (ch === '\r' && text[i + 1] === '\n') i++
      yield row; row = []; continue
    }
    if (closed) throw new ExcelError('CSV 引号结束后存在非法字符')
    field += ch
  }
  if (quoted) throw new ExcelError('CSV 存在未闭合的引号')
  if (field || row.length || closed) yield [...row, field]
}
export function csvWorkbook(text) {
  const sheet = Object.create(null)
  let rows = 0, columns = 0, indexedRows = 0, indexedColumns = 0, cells = 0, limited = false
  for (const row of rowsOf(text, delimiterOf(text))) {
    columns = Math.max(columns, row.length); rows++
    if (columns > 16384 || rows > 1048576) throw new ExcelError('CSV 超过 Excel 的行列上限')
    if (rows > LIMITS.rows || cells + row.length > LIMITS.cells) limited = true
    if (limited) continue
    indexedRows = rows; indexedColumns = Math.max(indexedColumns, row.length); cells += row.length
    row.forEach((value, col) => {
      sheet[XLSX.utils.encode_cell({ r: rows - 1, c: col })] = value ? { t: 's', v: value, w: value } : { t: 'z', w: '' }
    })
  }
  const range = (height, width) => height && width ? XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: height - 1, c: width - 1 } }) : undefined
  sheet['!ref'] = range(indexedRows, indexedColumns); sheet['!fullref'] = range(rows, columns)
  return { SheetNames: ['Sheet1'], Sheets: { Sheet1: sheet } }
}
