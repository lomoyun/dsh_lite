import { normalizeTables, TABLE_LIMITS } from './table-data.js'

const FILE_TYPES = { xlsx: 'Excel', xls: 'Excel', csv: 'CSV' }
const UPLOAD_TIMEOUT_MS = 30000
const fingerprint = (file) => JSON.stringify([file.name, file.size, file.lastModified ?? 0])

function checkFile(file) {
  if (typeof file.name !== 'string' || !file.name || file.name.length > 120) throw new Error('文件名无效或超过 120 字符')
  const extension = file.name.split('.').at(-1).toLowerCase()
  if (!Object.hasOwn(FILE_TYPES, extension)) throw new Error(`${file.name}：暂不支持此格式，请添加 Excel 或 CSV 文件`)
  if (!Number.isSafeInteger(file.size) || file.size <= 0) throw new Error(`${file.name}：文件为空，请检查文件内容`)
  if (file.size > TABLE_LIMITS.fileBytes) throw new Error(`${file.name}：文件超过 5 MB，请拆分后添加`)
  return FILE_TYPES[extension]
}

async function uploadAttachment(file, context) {
  const response = await fetch(context?.sessionId ? '/api/excel/upload' : '/api/tables/import', { method: 'POST', body: file,
    headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name),
      ...(context?.sessionId ? { 'X-Session-Id': context.sessionId } : {}) },
    signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS) })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || '附件解析失败，请检查文件后重试')
  return result
}

export class AttachmentQueue {
  constructor({ upload = uploadAttachment, onChange = () => {}, deduplicate = true } = {}) {
    this.entries = []; this.sequence = 0; this.upload = upload; this.onChange = onChange; this.processing = false
    this.deduplicate = deduplicate
  }
  assertIdle() { if (this.processing) throw new Error('正在上传附件，请稍候') }
  hasFiles() { return this.entries.length > 0 }
  list() { return this.entries.map(({ id, file, type, status, error }) => ({ id, name: file.name, size: file.size, type, status, error })) }
  add(files) {
    this.assertIdle()
    const known = new Set(this.entries.map((entry) => fingerprint(entry.file)))
    const added = []
    for (const file of files) {
      const type = checkFile(file), key = fingerprint(file)
      if (this.deduplicate && known.has(key)) continue
      known.add(key); added.push({ id: String(++this.sequence), file, type, status: 'pending', error: '' })
    }
    if (this.entries.length + added.length > TABLE_LIMITS.tables) throw new Error(`每次最多添加 ${TABLE_LIMITS.tables} 个附件`)
    this.entries.push(...added); this.onChange()
    return added.length
  }
  remove(id) {
    this.assertIdle()
    const entry = this.entries.find((item) => item.id === id)
    if (entry?.workbook) return this.removeUploaded(entry)
    this.entries = this.entries.filter((item) => item.id !== id); this.onChange()
  }
  async removeUploaded(entry) {
    const response = await fetch('/api/excel/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileId: entry.workbook.fileId, sessionId: entry.workbook.sessionId }) })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error)
    this.entries = this.entries.filter((item) => item !== entry); this.onChange()
  }
  clear() { this.assertIdle(); this.entries = []; this.onChange() }
  async read(entry) {
    if (entry.tables) return entry.tables
    entry.status = 'uploading'; entry.error = ''; this.onChange()
    try {
      const result = await this.upload(entry.file)
      if (!result.tables?.length) throw new Error('未读到表格内容')
      entry.tables = normalizeTables(result.tables); entry.status = 'ready'
      return entry.tables
    } catch (error) {
      entry.status = 'error'
      entry.error = error.name === 'TimeoutError' ? '上传超时，请重新发送' : error.message
      throw new Error(`${entry.file.name}：${entry.error}`)
    } finally { this.onChange() }
  }
  async collect(existing = []) {
    this.assertIdle()
    const tables = normalizeTables(existing)
    this.processing = true
    try {
      for (const entry of this.entries) tables.push(...await this.read(entry))
      return normalizeTables(tables)
    } finally { this.processing = false }
  }
  async collectWorkbooks(context) {
    this.assertIdle(); this.processing = true
    try {
      for (const entry of this.entries) {
        if (entry.workbook?.sessionId === context.sessionId) continue
        entry.status = 'uploading'; entry.error = ''; this.onChange()
        try {
          const result = await this.upload(entry.file, context)
          if (!result.file?.fileId) throw new Error('未收到工作簿引用')
          entry.workbook = result.file; entry.status = result.file.status === 'failed' ? 'saved' : 'ready'
          entry.error = result.file.error ?? ''
        } catch (error) { entry.status = 'error'; entry.error = error.message; throw error }
        finally { this.onChange() }
      }
      return this.entries.map((entry) => entry.workbook)
    } finally { this.processing = false }
  }
}
