import { PERSONA_SECTION, renderPrompt } from '@deepseek-ai/dsh-system-prompt'

export const NS = 'prompt-config-ui'
export const MAX_PROMPT = 24000
export class InputError extends Error {}

export function validate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new InputError('请求格式无效')
  if (!['inherit', 'persona', 'complete'].includes(input.mode)) throw new InputError('请选择覆盖模式')
  if (typeof input.text !== 'string' || input.text.length > MAX_PROMPT) throw new InputError('提示词最多 24000 字符')
  if (input.mode !== 'inherit' && !input.text.trim()) throw new InputError('自定义提示词不能为空')
  const draft = { mode: input.mode, text: input.text }
  try {
    renderPrompt({ sections: [{ name: 'validation', text: draft.text }], contexts: [], tools: [],
      variables: { model: 'model', provider: 'provider', cwd: 'workspace' } })
  } catch { throw new InputError('模板变量仅支持 {{model}}、{{provider}}、{{cwd}}，请检查双花括号写法') }
  return draft
}

export function overrideAssembly(assembly, draft) {
  if (draft.mode === 'inherit') return assembly
  const section = { name: PERSONA_SECTION, text: draft.text }
  if (draft.mode === 'complete') return { ...assembly, sections: [section] }
  const sections = assembly.sections.map((s) => s.name === PERSONA_SECTION ? section : s)
  if (!sections.some((s) => s.name === PERSONA_SECTION)) sections.push(section)
  return { ...assembly, sections }
}

export function mountPrompt(ctx, draft) {
  if (draft.mode === 'inherit') return () => {}
  return ctx.systemPrompt.section({ name: PERSONA_SECTION,
    order: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA'),
    text: draft.text, complete: draft.mode === 'complete' })
}

export async function preview(ctx, input) {
  const draft = validate(input)
  const selection = ctx.agentDefaultModel.currentSelection()
  const base = await ctx.systemPrompt.assemble()
  const assembly = overrideAssembly(base, draft)
  assembly.variables = { ...assembly.variables, ...selection, cwd: process.env.LITE_PROJECT_CWD || process.cwd() }
  return { system: renderPrompt(assembly), model: selection.model, provider: selection.provider,
    sections: assembly.sections.map((s) => s.name), tools: assembly.tools.map((t) => t.name),
    defaultPersona: base.sections.find((s) => s.name === PERSONA_SECTION)?.text ?? '' }
}

export async function state(ctx) {
  const config = ctx.settings.get(NS)
  const revision = ctx.settings.describe({ redactSecrets: true }).find((s) => s.ns === NS).revision
  return { ...config, revision, preview: await preview(ctx, config) }
}

export async function save(ctx, input) {
  const draft = validate(input)
  if (!Number.isSafeInteger(input.revision) || input.revision < 0) throw new InputError('配置版本无效，请重新加载')
  await preview(ctx, draft)
  await ctx.settings.replace(NS, draft, input.revision)
  return { ok: true }
}
