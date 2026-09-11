import { mkdir, readFile, writeFile, rename, readdir, rm } from 'node:fs/promises'
import { resolve, join, relative } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { ExcelError, VERSION, requireId, checkInput } from './limits.js'
import { parseInWorker } from './parse.js'

export const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'))
export async function atomicJson(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify(value), { flag: 'wx' })
  for (let attempt = 0; ; attempt++) {
    try { await rename(temporary, path); return }
    catch (error) {
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 5) throw error
      await delay(20 * (attempt + 1))
    }
  }
}
export class WorkbookStore {
  constructor(root, parse = parseInWorker) { this.root = resolve(root); this.parse = parse; this.locks = new Map() }
  directory(id) {
    const path = resolve(this.root, requireId(id))
    if (relative(this.root, path) !== id) throw new ExcelError('附件路径无效')
    return path
  }
  async create(input) {
    requireId(input.sessionId); checkInput(input)
    const fileId = randomUUID(), directory = this.directory(fileId)
    await mkdir(directory, { recursive: true })
    const meta = { schemaVersion: VERSION, fileId, sessionId: input.sessionId, name: input.name,
      sha256: digest(input.bytes), bytes: input.bytes.length, createdAt: new Date().toISOString(), status: 'parsing' }
    await writeFile(join(directory, 'original'), input.bytes, { flag: 'wx' })
    await atomicJson(join(directory, 'meta.json'), meta)
    try {
      const index = await this.parse(input), json = JSON.stringify(index)
      await writeFile(join(directory, 'index.json'), json, { flag: 'wx' })
      Object.assign(meta, { status: 'ready', format: index.format, indexSha256: digest(json) })
    } catch (error) { Object.assign(meta, { status: 'failed', error: error.message }) }
    await atomicJson(join(directory, 'state.json'), { reads: [], previews: [], results: [] })
    await atomicJson(join(directory, 'meta.json'), meta)
    return meta
  }
  async owned(fileId, sessionId) {
    requireId(sessionId)
    let meta
    try { meta = await readJson(join(this.directory(fileId), 'meta.json')) }
    catch (error) { if (error.code === 'ENOENT') throw new ExcelError('附件已删除或不存在', 404); throw error }
    if (meta.sessionId !== sessionId) throw new ExcelError('附件不属于当前会话', 403)
    return meta
  }
  async load(fileId, sessionId) {
    const meta = await this.owned(fileId, sessionId)
    if (meta.status !== 'ready') throw new ExcelError(`原文件已保存，结构解析未完成：${meta.error ?? meta.status}`)
    const bytes = await readFile(join(this.directory(fileId), 'index.json'))
    if (digest(bytes) !== meta.indexSha256) throw new ExcelError('工作簿索引摘要不一致，请重新上传')
    return { meta, index: JSON.parse(bytes), state: await readJson(join(this.directory(fileId), 'state.json')) }
  }
  async serial(fileId, callback) {
    const previous = this.locks.get(fileId) ?? Promise.resolve()
    const current = previous.catch(() => {}).then(callback); this.locks.set(fileId, current)
    try { return await current } finally { if (this.locks.get(fileId) === current) this.locks.delete(fileId) }
  }
  async update(fileId, sessionId, callback) {
    return this.serial(fileId, async () => {
      const data = await this.load(fileId, sessionId), result = await callback(data)
      await atomicJson(join(this.directory(fileId), 'state.json'), data.state)
      return result
    })
  }
  async list(sessionId) {
    requireId(sessionId)
    const names = await readdir(this.root).catch((error) => { if (error.code === 'ENOENT') return []; throw error })
    const metas = await Promise.all(names.filter((name) => /^[a-f0-9-]{36}$/.test(name)).map(async (name) => {
      try { return await this.owned(name, sessionId) } catch (error) { if ([403, 404].includes(error.status)) return null; throw error }
    }))
    return metas.filter(Boolean)
  }
  async remove(fileId, sessionId) {
    return this.serial(fileId, async () => {
      await this.owned(fileId, sessionId)
      // 仅清理显式删除的附件目录；directory 校验 UUID 及根目录归属。
      await rm(this.directory(fileId), { recursive: true, force: true })
      return { deleted: true, fileId }
    })
  }
}
