import { InputError } from './store.js'
import { saveProject, changeSession } from './projects.js'

const MAX_BODY = 128 * 1024
function json(response, code, data) {
  response.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(data))
}
async function inputOf(request) {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new InputError('请使用 JSON')
  request.setEncoding('utf8')
  let body = ''
  for await (const chunk of request) { body += chunk; if (Buffer.byteLength(body) > MAX_BODY) throw new InputError('请求过长') }
  try { const input = JSON.parse(body); if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error(); return input }
  catch { throw new InputError('请求格式无效') }
}
export function createHandler(workspace) {
  return async (request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    const host = request.headers.host ?? ''
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host) ||
      (request.headers.origin && request.headers.origin !== `http://${host}`)) return json(response, 403, { error: '仅支持本地同源访问' })
    try {
      if (request.method === 'GET' && request.url === '/api/workspace/state') return json(response, 200, await workspace.catalog())
      if (request.method !== 'POST') return json(response, 404, { error: '未找到接口' })
      const input = await inputOf(request)
      if (request.url === '/api/workspace/project') await saveProject(workspace, input)
      else if (request.url === '/api/workspace/session') await changeSession(workspace, input)
      else return json(response, 404, { error: '未找到接口' })
      json(response, 200, { ok: true })
    } catch (error) {
      json(response, error.code === 'WORKSPACE_CONFLICT' ? 409 : error instanceof InputError ? 400 : 422,
        { error: error instanceof InputError ? error.message : '工作区操作失败，原始会话日志未被删除' })
    }
  }
}
