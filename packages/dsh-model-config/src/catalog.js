import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { profileOf, providerEntry } from './service.js'
import { endpoint, InputError, routeId } from './validation.js'

const MAX_RESPONSE_BYTES = 1024 * 1024
const MAX_MODELS = 500
const TIMEOUT_MS = 10000

async function readCatalog(response) {
  if (!response.ok) {
    await response.body?.cancel()
    if ([404, 405].includes(response.status)) throw new InputError('服务未提供模型列表接口，请手动添加模型；这不代表推理接口不可用')
    throw new InputError(`模型列表请求失败（HTTP ${response.status}），请检查地址、权限和密钥`)
  }
  let body = ''
  let bytes = 0
  const decoder = new TextDecoder()
  for await (const chunk of response.body) {
    bytes += chunk.byteLength
    if (bytes > MAX_RESPONSE_BYTES) throw new InputError('模型列表响应过大，请手动添加模型')
    body += decoder.decode(chunk, { stream: true })
  }
  const data = JSON.parse(body + decoder.decode())
  if (!Array.isArray(data.data)) throw new InputError('服务返回的模型列表格式不受支持，请手动添加')
  return [...new Set(data.data.map((item) => item?.id).filter((id) => typeof id === 'string' && id.length > 0 && id.length <= 200))]
    .slice(0, MAX_MODELS).map((id) => ({ id }))
}

// 仅在用户点击时请求目录，不发起推理，不跟随重定向转发密钥。
export async function fetchCatalog(ctx, input) {
  const entry = providerEntry(ctx, routeId(input.provider))
  const profile = profileOf(ctx, entry)
  const base = endpoint(profile.baseURL || 'https://api.deepseek.com')
  const ref = profile.apiKeyEnv || (entry.provider === 'deepseek-official' ? 'DEEPSEEK_API_KEY' : '')
  const key = ref ? (await ctx.credentials.resolve(credentialRef(ref)))?.value : undefined
  if (!key) throw new InputError('请先保存 API Key，再测试连接')
  const anthropic = profile.api === 'anthropic-messages'
  const headers = anthropic ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' } : { Authorization: `Bearer ${key}` }
  const prefix = base.replace(/\/$/, '')
  const url = `${prefix}${anthropic && !prefix.endsWith('/v1') ? '/v1' : ''}/models`
  try {
    const response = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) })
    return { models: await readCatalog(response), message: '模型列表接口可访问；尚未验证实际推理。' }
  } catch (error) {
    if (error instanceof InputError) throw error
    throw new InputError('无法读取模型列表：请求超时、网络错误或格式不受支持；可以手动添加模型')
  }
}
