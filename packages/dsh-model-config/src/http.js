import { readFile } from 'node:fs/promises'
import { getState, saveCredential, saveLimits, saveProvider, saveSelection } from './service.js'
import { InputError, MAX_BODY_BYTES } from './validation.js'
import { saveConnection, saveModel } from './connections.js'
import { fetchCatalog } from './catalog.js'

const assets = new Map([
  ['/models', ['index.html', 'text/html']],
  ['/models/app.js', ['app.js', 'text/javascript']],
  ['/models/style.css', ['style.css', 'text/css']],
  ['/models/views.js', ['views.js', 'text/javascript']],
])
const actions = new Map([
  ['/api/model-config/connection', saveConnection],
  ['/api/model-config/model', saveModel],
  ['/api/model-config/catalog', fetchCatalog],
  ['/api/model-config/provider', saveProvider],
  ['/api/model-config/selection', saveSelection],
  ['/api/model-config/credential', saveCredential],
  ['/api/model-config/limits', saveLimits],
])
function json(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(data))
}
async function inputOf(request) {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new InputError('请使用 JSON 请求')
  request.setEncoding('utf8')
  let body = ''
  for await (const chunk of request) {
    body += chunk
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) throw new InputError('请求过长')
  }
  try {
    const value = JSON.parse(body)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error()
    return value
  } catch { throw new InputError('请求格式无效') }
}

export function createConfigHandler(ctx) {
  let writing = false
  return async (request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'; form-action 'self'")
    const host = request.headers.host ?? ''
    if (!/^(localhost|127\.0\.0\.1):\d+$/.test(host)) return json(response, 403, { error: '仅支持本地访问' })
    if (request.headers.origin && request.headers.origin !== `http://${host}`) return json(response, 403, { error: '禁止跨站请求' })
    try {
      if (request.method === 'GET' && request.url === '/api/model-config/state') return json(response, 200, await getState(ctx))
      const action = actions.get(request.url)
      if (request.method === 'POST' && action) {
        if (writing) return json(response, 409, { error: '正在保存，请稍后重试' })
        writing = true
        try { const result = await action(ctx, await inputOf(request)); return json(response, 200, { ok: true, ...result }) }
        finally { writing = false }
      }
      const asset = assets.get(request.url)
      if (request.method !== 'GET' || !asset) return json(response, 404, { error: '未找到页面' })
      const body = await readFile(new URL(`../public/${asset[0]}`, import.meta.url))
      response.writeHead(200, { 'Content-Type': `${asset[1]}; charset=utf-8` })
      response.end(body)
    } catch (error) {
      const conflict = error.code === 'SETTINGS_CONFLICT'
      const status = conflict ? 409 : error instanceof InputError ? 400 : 422
      const message = conflict ? '配置已被其他操作更新，请重新加载后再保存' :
        error instanceof InputError ? error.message : '保存或读取失败，请检查配置、适配器和密钥来源；原有配置未被整体替换'
      json(response, status, { error: message })
    }
  }
}
