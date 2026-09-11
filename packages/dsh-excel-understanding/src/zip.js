import { inflateRawSync } from 'node:zlib'
import { ExcelError, LIMITS } from './limits.js'

const END = 0x06054b50, ENTRY = 0x02014b50, LOCAL = 0x04034b50
function directory(bytes) {
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
    if (bytes.readUInt32LE(offset) !== END) continue
    const count = bytes.readUInt16LE(offset + 10), start = bytes.readUInt32LE(offset + 16)
    if (bytes.readUInt16LE(offset + 4) || !count || count > LIMITS.zipEntries || start >= offset) break
    return { count, start, end: offset }
  }
  throw new ExcelError('不支持的 ZIP 结构或工作簿内容过大')
}
function entryAt(bytes, offset) {
  if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== ENTRY) throw new ExcelError('Excel 压缩目录损坏')
  const flags = bytes.readUInt16LE(offset + 8), method = bytes.readUInt16LE(offset + 10)
  const compressed = bytes.readUInt32LE(offset + 20), expanded = bytes.readUInt32LE(offset + 24)
  const nameLength = bytes.readUInt16LE(offset + 28), local = bytes.readUInt32LE(offset + 42)
  const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString('utf8')
  if ((flags & 1) || ![0, 8].includes(method) || local + 30 > bytes.length) throw new ExcelError('不支持加密或特殊压缩的工作簿')
  if (bytes.readUInt32LE(local) !== LOCAL) throw new ExcelError('Excel 数据段损坏')
  const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28)
  if (start + compressed > bytes.length || name.includes('..') || name.startsWith('/')) throw new ExcelError('Excel 数据段越界')
  return { name, method, expanded, data: bytes.subarray(start, start + compressed),
    next: offset + 46 + nameLength + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32) }
}
export function readZip(bytes) {
  const dir = directory(bytes), entries = [], files = new Map()
  let offset = dir.start, expanded = 0
  for (let index = 0; index < dir.count; index++) {
    const entry = entryAt(bytes, offset)
    expanded += entry.expanded; offset = entry.next
    if (expanded > LIMITS.expandedBytes || offset > dir.end) throw new ExcelError('Excel 解压内容超过 64 MB 限制')
    entries.push(entry)
  }
  for (const entry of entries) {
    const data = entry.method === 0 ? entry.data : inflateRawSync(entry.data, { maxOutputLength: Math.max(1, entry.expanded) })
    if (data.length !== entry.expanded || files.has(entry.name)) throw new ExcelError('Excel ZIP 长度或文件名异常')
    files.set(entry.name, data)
  }
  return files
}
