import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { endpoint, InputError, keyReference, NS, positive, revision, routeId, text } from './validation.js'

export function descriptor(ctx, ns) {
  const result = ctx.settings.describe({ redactSecrets: true }).find((item) => item.ns === ns)
  if (!result) throw new InputError('所需模型适配器尚未加载')
  return result
}

export function providerEntry(ctx, provider) {
  const found = ctx.llm.listConfigurableProviders().find((item) => item.provider === provider)
  if (!found || !['llm-deepseek', 'llm-pi-ai'].includes(found.settingsNs)) {
    throw new InputError('此提供方暂不支持在本页面编辑')
  }
  return found
}

export function profileOf(ctx, entry) {
  return entry.settingsPath.reduce((value, key) => value?.[key], ctx.settings.get(entry.settingsNs)) ?? {}
}

async function providerView(ctx, entry) {
  const profile = profileOf(ctx, entry)
  const ref = profile.apiKeyEnv || (entry.provider === 'deepseek-official' ? 'DEEPSEEK_API_KEY' : '')
  let models = []
  try { models = await ctx.llm.listModels(entry.provider) } catch { /* 未启用的提供方仍可配置。 */ }
  return {
    id: entry.provider, name: entry.displayName, namespace: entry.settingsNs,
    revision: descriptor(ctx, entry.settingsNs).revision,
    baseURL: profile.baseURL ?? '', api: profile.api ?? '', apiKeyEnv: ref,
    configuredModels: (profile.models ?? []).map(({ id, name, contextWindow, maxTokens }) => ({ id, name, contextWindow, maxTokens })),
    models: models.map(({ id, name }) => ({ id, name })),
    credential: ref ? await ctx.credentials.describe(credentialRef(ref)) : { configured: false, writable: true },
  }
}

export async function getState(ctx) {
  const entries = ctx.llm.listConfigurableProviders().filter((item) => ['llm-deepseek', 'llm-pi-ai'].includes(item.settingsNs))
  const providers = await Promise.all(entries.map((entry) => providerView(ctx, entry)))
  const selection = ctx.agentDefaultModel.currentSelection()
  const limits = ctx.settings.get(NS)
  const maxTokens = limits.modelLimits?.find((item) => item.provider === selection.provider && item.model === selection.model)?.maxTokens ?? limits.maxTokens
  const selected = { ...selection, maxTokens }
  return { selected, revision: descriptor(ctx, 'agent-default-model').revision,
    limitsRevision: descriptor(ctx, NS).revision, modelLimits: limits.modelLimits ?? [],
    providerRevision: ctx.settings.describe({ redactSecrets: true }).find((item) => item.ns === 'llm-pi-ai')?.revision ?? null, providers }
}

export async function saveProvider(ctx, input) {
  const id = routeId(input.provider)
  let entry = ctx.llm.listConfigurableProviders().find((item) => item.provider === id)
  if (input.createOnly && entry) throw new InputError('该配置 ID 已存在，请换一个名称，或从侧栏编辑原配置')
  if (!entry) entry = { provider: id, settingsNs: 'llm-pi-ai', settingsPath: ['providers', id] }
  if (!['llm-deepseek', 'llm-pi-ai'].includes(entry.settingsNs)) throw new InputError('不支持的适配器')
  const draft = { baseURL: endpoint(input.baseURL), apiKeyEnv: keyReference(input.apiKeyEnv) }
  if (entry.settingsNs === 'llm-pi-ai' && input.name) draft.displayName = text(input.name, '连接名称', 80)
  if (entry.settingsNs === 'llm-pi-ai' && input.api) {
    if (!['openai-completions', 'openai-responses', 'anthropic-messages'].includes(input.api)) {
      throw new InputError('请选择受支持的协议')
    }
    draft.api = input.api
  }
  // 按模型 ID 更新或追加，不覆盖同一连接中已保存的其他模型。
  if (input.modelId) {
    const model = { id: text(input.modelId, '模型 ID'),
      contextWindow: positive(input.contextWindow, '上下文长度'),
      maxTokens: positive(input.maxTokens, '最大输出长度') }
    if (model.maxTokens > model.contextWindow) throw new InputError('输出长度不能大于上下文长度')
    const current = profileOf(ctx, entry).models ?? []
    const previous = current.find((item) => item.id === model.id)
    draft.models = [...current.filter((item) => item.id !== model.id), { ...previous, ...model }]
  }
  if (!ctx.llm.listConfigurableProviders().some((item) => item.provider === id) && !draft.models) {
    throw new InputError('新增提供方需要填写模型 ID 和容量')
  }
  if (!ctx.llm.listConfigurableProviders().some((item) => item.provider === id) && !draft.api) {
    throw new InputError('新增提供方需要选择协议')
  }
  const ops = Object.entries(draft).map(([key, value]) => ({ op: 'set', path: [...entry.settingsPath, key], value }))
  await ctx.settings.mutate(entry.settingsNs, ops, revision(input.revision))
}

export async function saveSelection(ctx, input) {
  const provider = routeId(input.provider)
  providerEntry(ctx, provider)
  const model = text(input.model, '模型 ID')
  // 使用适配器自身的模型解析验证路由，不发起模型请求。
  await ctx.llm.resolveModelInfo(provider, model)
  await ctx.settings.replace('agent-default-model', { provider, model }, revision(input.revision))
}

export async function saveLimits(ctx, input) {
  const maxTokens = positive(input.maxTokens, '输出上限')
  await ctx.settings.update(NS, { maxTokens }, revision(input.revision))
}

export async function saveCredential(ctx, input) {
  const entry = providerEntry(ctx, routeId(input.provider))
  const profile = profileOf(ctx, entry)
  const ref = keyReference(profile.apiKeyEnv || (entry.provider === 'deepseek-official' ? 'DEEPSEEK_API_KEY' : ''))
  await ctx.credentials.set(credentialRef(ref), text(input.apiKey, 'API Key', 8192))
}
