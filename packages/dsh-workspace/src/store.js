import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

export class InputError extends Error {}
export const conflict = () => Object.assign(new InputError('数据已更新，请重新加载后重试'), { code: 'WORKSPACE_CONFLICT' })
const initial = () => ({ version: 1, revision: 0, workspaces: [{ id: 'default', name: '个人工作区' }], projects: [], sessions: [] })

export class MetadataStore {
  constructor(path) {
    this.path = path
    this.data = initial()
    this.queue = Promise.resolve()
    this.ready = this.load()
    // 保留原始拒绝供请求报告，同时避免启动期间无人等待时出现未处理拒绝。
    this.ready.catch(() => {})
  }
  async load() {
    try {
      const data = JSON.parse(await readFile(this.path, 'utf8'))
      if (data.version !== 1 || !Number.isSafeInteger(data.revision) ||
        !Array.isArray(data.projects) || !Array.isArray(data.sessions) || !Array.isArray(data.workspaces)) throw new Error('Invalid metadata')
      this.data = data
    } catch (error) { if (error.code !== 'ENOENT') throw new Error('工作区元数据无法读取，已停止写入以保护原文件', { cause: error }) }
  }
  async view() { await this.ready; await this.queue; return structuredClone(this.data) }
  update(change, revision) {
    const work = this.queue.then(async () => {
      await this.ready
      if (revision !== undefined && revision !== this.data.revision) throw conflict()
      const draft = structuredClone(this.data)
      const result = await change(draft)
      draft.revision++
      await this.persist(draft)
      this.data = draft
      return result
    })
    this.queue = work.catch(() => {})
    return work
  }
  async persist(data) {
    await mkdir(dirname(this.path), { recursive: true })
    const temp = `${this.path}.${randomUUID()}.tmp`
    try {
      await writeFile(temp, JSON.stringify(data), { flag: 'wx', mode: 0o600 })
      await rename(temp, this.path)
    } catch (error) { await unlink(temp).catch(() => {}); throw error }
  }
}

export function text(value, options = {}) {
  if (typeof value !== 'string' || (!options.empty && !value.trim()) || value.length > (options.max ?? 80)) throw new InputError('文本为空或超过长度限制')
  return value.trim()
}
export function id(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(value)) throw new InputError('标识无效')
  return value
}
export function revision(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new InputError('版本无效，请重新加载')
  return value
}
