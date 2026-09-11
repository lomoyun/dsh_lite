import { mkdir, readFile, readdir, rename, writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { conflict, McheError, session } from './validation.js'
import { emptyCalculation } from './calculation-mapper.js'
import { emptyRequirements } from './requirements-boundary.js'

const initial = (sessionId) => ({ schemaVersion: 1, id: sessionId, sessionId, revision: 0, inputVersion: 0,
  inputReviewId: null, draft: {}, confirmed: {}, proposals: [], snapshots: {}, selections: { tube: null, fin: null, refrigerant: null },
  componentVersions: { tube: 0, fin: 0, refrigerant: 0 }, candidates: null, finCandidates: null, refrigerantCandidates: null, preparation: null, calculation: emptyCalculation(), requirements: emptyRequirements() })
// 单服务内串行提交；每一版使用新文件名，避免覆盖读取中的 Windows 文件。
export class CaseStore {
  constructor(root) { this.root = root; this.queues = new Map() }
  async read(sessionId) {
    const directory = join(this.root, session(sessionId))
    let files
    try { files = await readdir(directory) } catch (error) { if (error.code === 'ENOENT') return initial(sessionId); throw error }
    const revisions = files.filter((file) => /^\d{12}\.json$/.test(file)).sort()
    if (!revisions.length) return initial(sessionId)
    try {
      const data = JSON.parse(await readFile(join(directory, revisions.at(-1)), 'utf8'))
      if (data.schemaVersion !== 1 || data.sessionId !== sessionId || data.revision !== Number(revisions.at(-1).slice(0, -5))) throw new Error('invalid revision')
      // 旧的仅扁管记录在读取时补默认值，不改写历史版本或快照。
      return { ...data, requirements: { ...emptyRequirements(), ...data.requirements }, calculation: { ...emptyCalculation(), ...data.calculation }, selections: { fin: null, refrigerant: null, ...data.selections }, finCandidates: data.finCandidates ?? null,
        refrigerantCandidates: data.refrigerantCandidates ?? null,
        componentVersions: { tube: data.inputVersion, fin: data.inputVersion, refrigerant: data.inputVersion, ...data.componentVersions } }
    } catch (error) { throw new McheError('方案持久化记录无法读取，已停止写入以保护历史', 503) }
  }
  async view(sessionId) { session(sessionId); await this.queues.get(sessionId); return this.read(sessionId) }
  update(sessionId, options, change) {
    session(sessionId)
    const work = (this.queues.get(sessionId) ?? Promise.resolve()).then(async () => {
      const state = await this.read(sessionId)
      if (options.requireRevision && !Number.isSafeInteger(options.revision)) throw conflict()
      if (options.revision !== undefined && options.revision !== state.revision) throw conflict()
      await change(state)
      state.revision++; state.updatedAt = new Date().toISOString()
      await this.persist(state)
      return structuredClone(state)
    })
    const settled = work.catch(() => {})
    this.queues.set(sessionId, settled)
    void settled.then(() => { if (this.queues.get(sessionId) === settled) this.queues.delete(sessionId) })
    return work
  }
  async persist(state) {
    const directory = join(this.root, state.sessionId)
    await mkdir(directory, { recursive: true })
    const temp = join(directory, `${randomUUID()}.tmp`)
    const target = join(directory, `${String(state.revision).padStart(12, '0')}.json`)
    try {
      await writeFile(temp, JSON.stringify(state), { flag: 'wx', mode: 0o600 })
      await rename(temp, target)
    } catch (error) { await unlink(temp).catch(() => {}); throw error }
  }
}
