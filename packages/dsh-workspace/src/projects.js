import { randomUUID } from 'node:crypto'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { InputError, id, revision, text } from './store.js'

export function projectOf(data, projectId, allowArchived = false) {
  if (!projectId) return undefined
  const project = data.projects.find((p) => p.id === id(projectId) && p.workspaceId === 'default')
  if (!project || (!allowArchived && project.archived)) throw new InputError('项目不存在或已归档')
  return project
}
function promptOf(input) {
  const mode = input.promptMode ?? 'inherit'
  if (!['inherit', 'persona', 'complete'].includes(mode)) throw new InputError('提示词模式无效')
  const value = text(input.promptText ?? '', { empty: mode === 'inherit', max: 24000 })
  try {
    renderPrompt({ sections: [{ name: 'project', text: value }], contexts: [], tools: [], variables: { model: 'model', provider: 'provider', cwd: 'cwd' } })
  } catch { throw new InputError('提示词变量仅支持 model、provider、cwd') }
  return { mode, text: value }
}
export async function saveProject(workspace, input) {
  const prompt = promptOf(input)
  const model = input.model ? { provider: text(input.model.provider), model: text(input.model.model, { max: 200 }) } : null
  if (model) await workspace.ctx.llm.resolveModelInfo(model.provider, model.model)
  const fields = { name: text(input.name), instructions: text(input.instructions ?? '', { empty: true, max: 8000 }), model, prompt }
  if (input.archived !== undefined && typeof input.archived !== 'boolean') throw new InputError('归档状态无效')
  return workspace.store.update((data) => {
    const existing = projectOf(data, input.id, true)
    if (existing) Object.assign(existing, fields, { archived: input.archived ?? existing.archived })
    else data.projects.push({ id: randomUUID(), workspaceId: 'default', archived: false, ...fields })
  }, revision(input.revision))
}
export async function changeSession(workspace, input) {
  return workspace.store.update((data) => {
    const record = data.sessions.find((s) => s.id === id(input.id))
    if (!record) throw new InputError('会话不存在')
    if (input.title !== undefined) { record.title = text(input.title); record.renamed = true }
    if (input.projectId !== undefined && input.projectId !== record.projectId) record.projectId = projectOf(data, input.projectId)?.id ?? null
    if (input.archived !== undefined) {
      if (typeof input.archived !== 'boolean') throw new InputError('归档状态无效')
      record.archived = input.archived
    }
  }, revision(input.revision))
}
