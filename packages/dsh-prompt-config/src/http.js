import { readFile } from 'node:fs/promises'
import { InputError, preview, save, state } from './service.js'

const MAX_BODY = 128 * 1024
const assets = new Map([
  ['/prompts', ['index.html', 'text/html']],
  ['/prompts/app.js', ['app.js', 'text/javascript']],
  ['/prompts/style.css', ['style.css', 'text/css']],
])
function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
}
async function inputOf(request) {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new InputError('请使用 JSON 请求')
  request.setEncoding('utf8')
  let body = ''
  for await (const chunk of request) {
    body += chunk
    if (Buffer.byteLength(body) > MAX_BODY) throw new InputError('请求过长')
  }
  try { return JSON.parse(body) } catch { throw new InputError('请求格式无效') }
}
export function createHandler(ctx) {
  let writing = false
  return async (request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'; form-action 'self'")
    const host = request.headers.host ?? ''
    if (!/^(localhost|127\.0\.0\.1):\d+$/.test(host) ||
      (request.headers.origin && request.headers.origin !== `http://${host}`)) return json(response, 403, { error: '仅支持本地同源访问' })
    try {
      if (request.method === 'GET' && request.url === '/api/prompt-config/state') return json(response, 200, await state(ctx))
      if (request.method === 'POST' && ['/api/prompt-config/save', '/api/prompt-config/preview'].includes(request.url)) {
        if (writing) return json(response, 409, { error: '正在处理，请稍后重试' })
        writing = true
        try {
          const input = await inputOf(request)
          const result = request.url.endsWith('/save') ? await save(ctx, input) : await preview(ctx, input)
          return json(response, 200, result)
        } finally { writing = false }
      }
      const asset = assets.get(request.url)
      if (request.method !== 'GET' || !asset) return json(response, 404, { error: '未找到页面' })
      const body = await readFile(new URL(`../public/${asset[0]}`, import.meta.url))
      response.writeHead(200, { 'Content-Type': `${asset[1]}; charset=utf-8` })
      response.end(body)
    } catch (error) {
      const conflict = error.code === 'SETTINGS_CONFLICT'
      json(response, conflict ? 409 : error instanceof InputError ? 400 : 422,
        { error: conflict ? '配置已更新，请保留草稿并重新加载后再保存' : error instanceof InputError ? error.message : '操作失败，请检查插件配置后重试' })
    }
  }
}
