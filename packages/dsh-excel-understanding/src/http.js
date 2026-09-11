import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, dirname } from 'node:path'
import { ExcelError, LIMITS } from './limits.js'

const require = createRequire(import.meta.url)
const pdfRoot = dirname(require.resolve('pdfjs-dist/package.json'))
const vendors = new Map([['/api/excel/pdf.mjs', 'build/pdf.mjs'], ['/api/excel/pdf.worker.mjs', 'build/pdf.worker.mjs']])
function json(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(data))
}
async function bytesOf(request, limit) {
  let size = 0; const chunks = []
  for await (const chunk of request) { size += chunk.length; if (size > limit) throw new ExcelError('请求内容超过限制'); chunks.push(chunk) }
  return Buffer.concat(chunks)
}
async function inputOf(request) {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new ExcelError('请使用 JSON 请求')
  const input = JSON.parse(await bytesOf(request, LIMITS.resultBytes))
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ExcelError('请求无效')
  return input
}
async function authorize(ctx, sessionId, write = false) {
  const workspace = ctx.get?.('liteWorkspace')
  if (!workspace) throw new ExcelError('会话归属服务不可用', 503)
  await (write ? workspace.resumable(sessionId) : workspace.requireRecord(sessionId))
}
export function createExcelHandler(service, ctx) {
  let uploading = false
  return async (request, response) => {
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff')
    const host = request.headers.host ?? ''
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host) || (request.headers.origin && request.headers.origin !== `http://${host}`)) return json(response, 403, { error: '仅支持本地同源访问' })
    try {
      const url = new URL(request.url, `http://${host}`), path = url.pathname
      if (request.method === 'GET' && vendors.has(path)) {
        response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' })
        return response.end(await readFile(join(pdfRoot, vendors.get(path))))
      }
      if (request.method === 'POST' && path === '/api/excel/upload') {
        if (uploading) throw new ExcelError('正在解析其他文件，请稍后重试', 409)
        uploading = true
        try {
          const sessionId = request.headers['x-session-id']; await authorize(ctx, sessionId, true)
          if (!request.headers['content-type']?.startsWith('application/octet-stream')) throw new ExcelError('请以文件内容上传')
          const name = decodeURIComponent(request.headers['x-file-name'] ?? ''), bytes = await bytesOf(request, LIMITS.fileBytes)
          return json(response, 200, await service.import({ sessionId, name, bytes, encoding: request.headers['x-text-encoding'] ?? 'auto' }))
        } finally { uploading = false }
      }
      if (request.method === 'GET' && path === '/api/excel/artifact') {
        const input = Object.fromEntries(url.searchParams); await authorize(ctx, input.sessionId)
        const artifact = await service.artifact(input)
        response.writeHead(200, { 'Content-Type': artifact.type,
          'Content-Disposition': `${artifact.name ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(artifact.name ?? input.artifact)}` })
        return response.end(artifact.bytes)
      }
      if (request.method !== 'POST') return json(response, 404, { error: '接口不存在' })
      const input = await inputOf(request); await authorize(ctx, input.sessionId)
      if (path === '/api/excel/list') return json(response, 200, { files: await service.store.list(input.sessionId) })
      if (path === '/api/excel/delete') return json(response, 200, await service.store.remove(input.fileId, input.sessionId))
      const method = { '/api/excel/inspect': 'inspect', '/api/excel/read': 'read', '/api/excel/search': 'search',
        '/api/excel/preview': 'preview', '/api/excel/result': 'result' }[path]
      if (!method) return json(response, 404, { error: '接口不存在' })
      json(response, 200, await service[method](input, method === 'read' ? 'browser' : undefined))
    } catch (error) { json(response, error.status ?? 400, { error: error.code === 'EXCEL_INVALID' ? error.message : '附件请求失败，请核对当前会话与文件' }) }
  }
}
