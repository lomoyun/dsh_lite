import { randomUUID } from 'node:crypto'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { descriptor, profileOf, providerEntry, saveProvider } from './service.js'
import { InputError, keyReference, NS, positive, revision, routeId, text } from './validation.js'

// 设置与凭据属于两个服务；明确返回部分保存状态，避免重试创建重复连接。
export async function saveConnection(ctx, input) {
  const id = input.provider ? routeId(input.provider) : `connection-${randomUUID()}`
  const entry = input.provider ? providerEntry(ctx, id) : undefined
  const profile = entry ? profileOf(ctx, entry) : {}
  const ref = keyReference(input.apiKeyEnv || profile.apiKeyEnv ||
    (id === 'deepseek-official' ? 'DEEPSEEK_API_KEY' : `DSH_LITE_${id.replaceAll('-', '_').toUpperCase()}_KEY`))
  const key = input.apiKey ? text(input.apiKey, 'API Key', 8192) : undefined
  if (key && !(await ctx.credentials.describe(credentialRef(ref))).writable) {
    throw new InputError('密钥由启动环境提供，不能在页面替换；可在高级设置更换密钥引用后保存')
  }
  await saveProvider(ctx, { ...input, provider: id, apiKeyEnv: ref, createOnly: !entry,
    name: text(input.name, '连接名称', 80) })
  if (key) {
    try { await ctx.credentials.set(credentialRef(ref), key) }
    catch { return { provider: id, partial: true, message: '连接已保存，但密钥保存失败。请保留密钥输入并重试。' } }
  }
  return { provider: id }
}

export async function saveModel(ctx, input) {
  const entry = providerEntry(ctx, routeId(input.provider))
  const model = text(input.modelId, '模型 ID')
  const maxTokens = positive(input.maxTokens, '输出上限')
  const contextWindow = positive(input.contextWindow, '上下文长度')
  if (maxTokens > contextWindow) throw new InputError('输出上限不能大于上下文长度')
  if (descriptor(ctx, NS).revision !== revision(input.limitsRevision)) {
    throw Object.assign(new Error('Conflict'), { code: 'SETTINGS_CONFLICT' })
  }
  const profile = profileOf(ctx, entry)
  await saveProvider(ctx, { provider: entry.provider, baseURL: profile.baseURL || 'https://api.deepseek.com',
    apiKeyEnv: profile.apiKeyEnv || 'DEEPSEEK_API_KEY', modelId: model,
    contextWindow, maxTokens, revision: input.revision })
  const current = ctx.settings.get(NS).modelLimits ?? []
  const modelLimits = [...current.filter((item) => item.provider !== entry.provider || item.model !== model),
    { provider: entry.provider, model, maxTokens }]
  try { await ctx.settings.update(NS, { modelLimits }, revision(input.limitsRevision)) }
  catch { return { partial: true, message: '模型目录已保存，但请求输出上限未保存，请重新加载后重试。' } }
  return {}
}
