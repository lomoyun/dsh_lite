export const VERSION = 1
export const LIMITS = Object.freeze({
  fileBytes: 5 * 1024 * 1024, expandedBytes: 64 * 1024 * 1024, zipEntries: 4096,
  sheets: 256, rows: 50000, cells: 200000, rangeCells: 2000, responseBytes: 32000,
  searchResults: 100, parseMs: 15000, workerMb: 384,
  previewMs: 60000, previewBytes: 20 * 1024 * 1024, previewPages: 12,
  fields: 500, resultBytes: 512 * 1024,
})
export class ExcelError extends Error {
  constructor(message, status = 400) { super(message); this.code = 'EXCEL_INVALID'; this.status = status }
}
export function requireId(value) {
  if (typeof value !== 'string' || !/^[a-f0-9-]{36}$/.test(value)) throw new ExcelError('无效的文件或会话标识')
  return value
}
export function checkInput({ name, bytes }) {
  if (typeof name !== 'string' || !name || name.length > 120 || /[/\\\0]/.test(name)) throw new ExcelError('文件名无效')
  if (!/\.(xlsx|xls|csv)$/i.test(name)) throw new ExcelError('请选择 XLSX、XLS 或 CSV 文件')
  if (!bytes.length || bytes.length > LIMITS.fileBytes) throw new ExcelError('文件为空或超过 5 MB')
}
