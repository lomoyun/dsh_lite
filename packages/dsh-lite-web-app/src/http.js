import { readFile } from 'node:fs/promises'

const MAX_BODY_BYTES = 32768
const MAX_PROMPT_LENGTH = 8000
const assets = new Map([
  ['/', ['index.html', 'text/html']],
  ['/app.js', ['app.js', 'text/javascript']],
  ['/style.css', ['style.css', 'text/css']],
  ['/sidebar.js', ['sidebar.js', 'text/javascript']],
  ['/workspace.css', ['workspace.css', 'text/css']],
  ['/project-dialog.js', ['project-dialog.js', 'text/javascript']],
])

function json(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(data))
}

async function inputOf(request) {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new Error('JSON required')
  let body = ''
  request.setEncoding('utf8')
  for await (const chunk of request) {
    body += chunk
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) throw new Error('Body too large')
  }
  const input = JSON.parse(body)
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid input')
  if (input.sessionId !== undefined && typeof input.sessionId !== 'string') throw new Error('Invalid session')
  if (input.projectId != null && typeof input.projectId !== 'string') throw new Error('Invalid project')
  if (input.choice !== undefined && (!input.choice || typeof input.choice !== 'object' ||
    typeof input.choice.provider !== 'string' || typeof input.choice.model !== 'string' ||
    !/^[a-z][a-z0-9-]{0,79}$/.test(input.choice.provider) || !input.choice.model.trim() || input.choice.model.length > 200)) {
    throw new Error('Invalid model choice')
  }
  if (input.choice) input.choice = { provider: input.choice.provider, model: input.choice.model }
  return input
}

function localRequest(request, response) {
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'; form-action 'self'")
  const host = request.headers.host ?? ''
  return /^(127\.0\.0\.1|localhost):\d+$/.test(host) &&
    (!request.headers.origin || request.headers.origin === `http://${host}`)
}

function createMutationHandler(runtime) {
  let busy = false
  return async (request, response) => {
    if (busy) return json(response, 409, { error: '当前正在回答，请稍后再试' })
    busy = true
    try {
      let input
      try { input = await inputOf(request) }
      catch { return json(response, 400, { error: '请求无效，请使用 JSON 提交' }) }
      if (request.url === '/api/session/close') {
        if (!input.sessionId) return json(response, 400, { error: '缺少对话标识' })
        await runtime.release(input.sessionId)
        return json(response, 200, { ok: true })
      }
      if (request.url === '/api/session/open') {
        if (!input.sessionId) return json(response, 400, { error: '缺少对话标识' })
        return json(response, 200, await runtime.open(input.sessionId))
      }
      if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > MAX_PROMPT_LENGTH) {
        return json(response, 400, { error: '请输入 1–8000 字的问题' })
      }
      if (!input.sessionId && !(await runtime.status(input.choice, input.projectId)).configured) {
        return json(response, 503, { error: '请在模型配置页面设置当前提供方的 API Key' })
      }
      const result = await runtime.run({ prompt: input.prompt.trim(), sessionId: input.sessionId, choice: input.choice, projectId: input.projectId })
      json(response, 200, result)
    } catch (error) {
      if (error.constructor.name === 'InputError') return json(response, 409, { error: error.message, sessionExpired: true })
      const expired = error.code === 'SESSION_EXPIRED'
      json(response, expired ? 409 : 502, {
        sessionExpired: true,
        error: expired ? '对话已失效，请新建对话' : '模型请求失败，请检查配置或网络后新建对话重试',
      })
    } finally { busy = false }
  }
}

export function createWebHandler(runtime) {
  const mutate = createMutationHandler(runtime)
  return async (request, response) => {
    if (!localRequest(request, response)) return json(response, 403, { error: '仅支持本地同源访问' })
    try {
      if (request.method === 'GET' && request.url === '/api/status') {
        return json(response, 200, await runtime.status())
      }
      if (request.method === 'POST' && ['/api/chat', '/api/session/close', '/api/session/open'].includes(request.url)) {
        return await mutate(request, response)
      }
      const asset = assets.get(request.url)
      if (request.method !== 'GET' || !asset) return json(response, 404, { error: '未找到页面' })
      const content = await readFile(new URL(`../public/${asset[0]}`, import.meta.url))
      response.writeHead(200, { 'Content-Type': `${asset[1]}; charset=utf-8` })
      response.end(content)
    } catch { if (!response.headersSent) json(response, 500, { error: '服务暂时不可用' }) }
  }
}
