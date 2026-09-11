import { readFile } from 'node:fs/promises'
import { normalizeTables } from '../public/table-data.js'
import { importTableFile } from './table-import.js'
import { respondRun } from './http-stream.js'
import { normalizeWorkbooks } from '../public/workbook-message.js'

const MAX_BODY_BYTES = 256 * 1024
const MAX_PROMPT_LENGTH = 8000
const assets = new Map([
  ['/', ['index.html', 'text/html']],
  ['/app.js', ['app.js', 'text/javascript']],
  ['/style.css', ['style.css', 'text/css']],
  ['/sidebar.js', ['sidebar.js', 'text/javascript']],
  ['/workspace.css', ['workspace.css', 'text/css']],
  ['/project-dialog.js', ['project-dialog.js', 'text/javascript']],
  ['/table-data.js', ['table-data.js', 'text/javascript']],
  ['/table-format.js', ['table-format.js', 'text/javascript']],
  ['/table-message.js', ['table-message.js', 'text/javascript']],
  ['/table-view.js', ['table-view.js', 'text/javascript']],
  ['/table-composer.js', ['table-composer.js', 'text/javascript']],
  ['/tables.css', ['tables.css', 'text/css']],
  ['/attachment-queue.js', ['attachment-queue.js', 'text/javascript']],
  ['/attachment-composer.js', ['attachment-composer.js', 'text/javascript']],
  ['/attachment-drop.js', ['attachment-drop.js', 'text/javascript']],
  ['/attachments.css', ['attachments.css', 'text/css']],
  ['/conversation-actions.js', ['conversation-actions.js', 'text/javascript']],
  ['/actions.css', ['actions.css', 'text/css']],
  ['/chat-stream.js', ['chat-stream.js', 'text/javascript']],
  ['/detail-drawer.js', ['detail-drawer.js', 'text/javascript']],
  ['/details.css', ['details.css', 'text/css']],
  ['/chat-view.js', ['chat-view.js', 'text/javascript']],
  ['/workbook-message.js', ['workbook-message.js', 'text/javascript']],
  ['/workbook-view.js', ['workbook-view.js', 'text/javascript']],
  ['/workbook-cells.js', ['workbook-cells.js', 'text/javascript']],
  ['/workbook-preview.js', ['workbook-preview.js', 'text/javascript']],
  ['/workbooks.css', ['workbooks.css', 'text/css']],
  ['/mche.css', ['mche.css', 'text/css']],
  ['/mche-view.js', ['mche-view.js', 'text/javascript']],
  ['/mche-guidance.js', ['mche-guidance.js', 'text/javascript']],
  ['/mche-elements.js', ['mche-elements.js', 'text/javascript']],
  ['/mche-inputs.js', ['mche-inputs.js', 'text/javascript']],
  ['/mche-candidates.js', ['mche-candidates.js', 'text/javascript']],
  ['/mche-fins.js', ['mche-fins.js', 'text/javascript']],
  ['/mche-refrigerants.js', ['mche-refrigerants.js', 'text/javascript']],
  ['/mche-calculation.js', ['mche-calculation.js', 'text/javascript']],
  ['/flow-topology.js', ['flow-topology.js', 'text/javascript']],
  ['/flow-scene.js', ['flow-scene.js', 'text/javascript']],
  ['/flow-animation.js', ['flow-animation.js', 'text/javascript']],
  ['/mche-requirements.js', ['mche-requirements.js', 'text/javascript']],
])
export const WEB_PATHS = [...assets.keys(), '/api/status', '/api/chat', '/api/session/prepare', '/api/session/close', '/api/session/open', '/api/tables/import', '/api/actions/decide']

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
  if (input.intent !== undefined && !['chat', 'extract'].includes(input.intent)) throw new Error('Invalid intent')
  input.tables = normalizeTables(input.tables ?? [])
  input.workbooks = normalizeWorkbooks(input.workbooks ?? [])
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
      if (request.url === '/api/session/prepare') {
        if (!(await runtime.status(input.choice, input.projectId)).configured) return json(response, 503, { error: '请先配置当前模型' })
        return json(response, 200, await runtime.prepare(input))
      }
      if (request.url === '/api/actions/decide') {
        return await respondRun({ request, response, json, fail: failureOf,
          execute: (onEvent) => runtime.decide({ sessionId: input.sessionId, id: input.id, decision: input.decision, onEvent }) })
      }
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
      return await respondRun({ request, response, json, fail: failureOf,
        execute: (onEvent) => runtime.run({ prompt: input.prompt.trim(), sessionId: input.sessionId, choice: input.choice,
          projectId: input.projectId, tables: input.tables, workbooks: input.workbooks, intent: input.intent ?? 'chat', onEvent }) })
    } catch (error) {
      const failure = failureOf(error)
      json(response, failure.status, failure)
    } finally { busy = false }
  }
}

function failureOf(error) {
  if (['TURN_TIMEOUT', 'TURN_IDLE_TIMEOUT'].includes(error.code)) return {
    status: 504, code: error.code, sessionId: error.sessionId, sessionExpired: true, error: error.message,
  }
  if (error.code === 'EXCEL_INVALID') return { status: error.status ?? 400, error: error.message }
  if (error.code === 'ACTION_INVALID') return { status: 409, error: error.message }
  if (error.constructor.name === 'InputError') return { status: 409, error: error.message, sessionExpired: true }
  const expired = error.code === 'SESSION_EXPIRED'
  return { status: expired ? 409 : 502, sessionExpired: true,
    error: expired ? '对话已失效，请新建对话' : '本轮未完成，请重新打开对话核对状态，并检查模型配置或网络。' }
}

export function createWebHandler(runtime) {
  const mutate = createMutationHandler(runtime)
  let importing = false
  return async (request, response) => {
    if (!localRequest(request, response)) return json(response, 403, { error: '仅支持本地同源访问' })
    try {
      if (request.method === 'POST' && request.url === '/api/tables/import') {
        if (importing) return json(response, 409, { error: '正在读取表格，请稍后再试' })
        importing = true
        try { return json(response, 200, await importTableFile(request)) }
        catch (error) { return json(response, 400, { error: `无法导入：${error.message}` }) }
        finally { importing = false }
      }
      if (request.method === 'GET' && request.url === '/api/status') {
        return json(response, 200, await runtime.status())
      }
      if (request.method === 'POST' && ['/api/chat', '/api/session/prepare', '/api/session/close', '/api/session/open', '/api/actions/decide'].includes(request.url)) {
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
