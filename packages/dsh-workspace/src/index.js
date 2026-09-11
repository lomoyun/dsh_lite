import { Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { join, resolve } from 'node:path'
import { MetadataStore, InputError, id } from './store.js'
import { snapshotOf, summary, titleOf } from './history.js'
import { projectOf } from './projects.js'
import { createHandler } from './http.js'

export const name = 'lite-workspace'
export const inject = ['sessionPersistence', 'settings', 'agentDefaultModel', 'llm', 'systemPrompt', 'webServer']
export const Config = z.object({ cwd: z.string().required(), home: z.string().required() })
const samePath = (a, b) => resolve(a).toLowerCase() === resolve(b).toLowerCase()

export class Workspace extends Service {
  constructor(ctx, config) {
    super(ctx, 'liteWorkspace')
    this.cwd = config.cwd
    this.store = new MetadataStore(join(config.home, 'lite-workspace.json'))
    this.importing = undefined
    this.warnings = []
  }
  record(id) { return this.store.data.sessions.find((s) => s.id === id) }
  async events(sessionId) {
    const live = this.ctx.get('agents')?.get(sessionId)
    if (live) return live.session.snapshotEvents()
    return (await this.ctx.sessionPersistence.inspect(sessionId)).events
  }
  async importLegacy() {
    if (this.importing) return this.importing
    this.importing = this.collectLegacy().finally(() => { this.importing = undefined })
    return this.importing
  }
  async collectLegacy() {
    await this.store.ready
    const existing = new Map(this.store.data.sessions.map((s) => [s.id, s]))
    const stored = await this.ctx.sessionPersistence.list()
    const additions = []
    const recoveries = []
    this.warnings = []
    for (const header of stored) {
      const record = existing.get(header.id)
      if (record?.visible || !header.cwd || !samePath(header.cwd, this.cwd) || header.parentSession || header.origin === 'subagent') continue
      let events
      try { events = await this.events(header.id) }
      catch { this.warnings.push(`会话 ${header.id} 无法读取，原日志未改动`); continue }
      if (record) {
        if (['completed', 'max-tokens'].includes(events.findLast((e) => e.type === 'turn/end')?.data.reason.kind)) {
          recoveries.push({ id: header.id, snapshot: snapshotOf(events), title: titleOf(events) })
        }
        continue
      }
      if (!events.some((e) => e.type === 'user/message' && e.data.source?.kind === 'user')) continue
      additions.push({ id: header.id, workspaceId: 'default', projectId: null, title: titleOf(events),
        createdAt: new Date(header.createdAt).toISOString(), updatedAt: new Date(events.at(-1)?.time ?? header.createdAt).toISOString(),
        visible: true, archived: false, status: 'legacy', snapshot: snapshotOf(events) })
    }
    if (additions.length || recoveries.length) await this.store.update((data) => {
      for (const record of additions) if (!data.sessions.some((s) => s.id === record.id)) data.sessions.push(record)
      for (const recovery of recoveries) {
        const record = data.sessions.find((s) => s.id === recovery.id)
        if (!record || record.visible) continue
        Object.assign(record, { visible: true, status: 'ready', snapshot: { ...record.snapshot, ...recovery.snapshot } })
        if (!record.renamed) record.title = recovery.title
      }
    })
  }
  async catalog() {
    await this.importLegacy()
    const data = await this.store.view()
    return { revision: data.revision, workspaces: data.workspaces, projects: data.projects, warnings: this.warnings,
      sessions: data.sessions.filter((s) => s.visible).map(summary).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))) }
  }
  async choice(input = {}) {
    const data = await this.store.view()
    const project = projectOf(data, input.projectId)
    return input.choice ?? project?.model ?? this.ctx.agentDefaultModel.currentSelection()
  }
  async prepare(input) {
    return this.store.update(async (data) => {
      const project = projectOf(data, input.projectId)
      const selected = input.choice ?? project?.model ?? this.ctx.agentDefaultModel.currentSelection()
      await this.ctx.llm.resolveModelInfo(selected.provider, selected.model)
      const has = (ns) => this.ctx.settings.describe({ redactSecrets: true }).some((s) => s.ns === ns)
      const limits = has('model-config-ui') ? this.ctx.settings.get('model-config-ui') : { maxTokens: 8192 }
      const globalPrompt = has('prompt-config-ui') ? this.ctx.settings.get('prompt-config-ui') : { mode: 'inherit', text: '' }
      const prompt = project?.prompt?.mode !== 'inherit' && project?.prompt ? project.prompt : globalPrompt
      const maxTokens = limits.modelLimits?.find((m) => m.provider === selected.provider && m.model === selected.model)?.maxTokens ?? limits.maxTokens
      const snapshot = { options: { provider: selected.provider, model: selected.model, maxTokens }, prompt, instructions: project?.instructions ?? '' }
      if ((prompt.mode !== 'inherit' || snapshot.instructions) && !this.ctx.get('promptSnapshots')) throw new InputError('请启用提示词插件以应用项目提示词和说明')
      data.sessions.push({ id: input.sessionId, workspaceId: 'default', projectId: project?.id ?? null, title: '新对话',
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), visible: false, archived: false, status: 'draft', snapshot })
      return snapshot
    })
  }
  async requireRecord(sessionId) {
    await this.importLegacy()
    const record = this.record(id(sessionId))
    if (!record) throw new InputError('会话不属于当前工作区')
    return structuredClone(record)
  }
  async resumable(sessionId) {
    const record = await this.requireRecord(sessionId)
    projectOf(await this.store.view(), record.projectId)
    if (record.archived) throw new InputError('会话已归档，请先取消归档')
    const liveDraft = record.status === 'draft' && this.ctx.get('agents')?.get(sessionId)
    if (!record.snapshot?.system && !liveDraft) throw new InputError('缺少原始模型或提示词快照，此会话只能查看，请新建对话')
    if (!this.ctx.get('promptSnapshots')) throw new InputError('请启用提示词插件后恢复会话，以保留原提示词')
    return record
  }
  async finish(sessionId, events, success) {
    if (success) await this.ctx.sessionPersistence.load(sessionId)
    await this.store.update((data) => {
      const record = data.sessions.find((s) => s.id === sessionId)
      if (!record) throw new InputError('会话归属丢失')
      const actual = snapshotOf(events)
      if (actual) record.snapshot = { ...record.snapshot, ...actual }
      if (!record.renamed) record.title = titleOf(events)
      record.updatedAt = new Date().toISOString()
      record.status = success ? 'ready' : 'failed'
      record.visible = record.visible || success
    })
  }
}
export function apply(ctx, config) {
  const workspace = new Workspace(ctx, config)
  const handler = createHandler(workspace)
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/api/workspace', handler }))
}
