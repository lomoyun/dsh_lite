import { McheError } from './validation.js'

const BODY_LIMIT = 64 * 1024
const methods = { case: 'get', draft: 'updateDraft', 'confirm-inputs': 'confirmInputs', search: 'search',
  tube: 'tube', recommend: 'recommend', propose: 'propose', 'confirm-tube': 'confirmTube', prepare: 'prepare',
  fin: 'fin', 'fin-search': 'finSearch', 'fin-recommend': 'finRecommend', 'fin-propose': 'finPropose', 'confirm-fin': 'confirmFin',
  refrigerant: 'refrigerant', 'refrigerant-search': 'refrigerantSearch', 'refrigerant-recommend': 'refrigerantRecommend',
  'refrigerant-propose': 'refrigerantPropose', 'confirm-refrigerant': 'confirmRefrigerant',
  'calculation-profile': 'calculationProfile', 'calculation-draft': 'calculationUpdateDraft', 'calculation-confirm': 'calculationConfirm',
  'requirements-files': 'requirementsFiles', 'requirements-read': 'requirementsRead', 'requirements': 'requirementsGet',
  'requirements-draft': 'requirementsUpdate', 'requirements-recommend': 'requirementsRecommend', 'requirements-confirm': 'requirementsConfirm',
  calculate: 'calculate', 'calculation-get': 'calculationGet', 'calculation-cancel': 'calculationCancel' }
const reads = new Set(['get', 'search', 'tube', 'fin', 'finSearch', 'refrigerant', 'refrigerantSearch', 'calculationProfile', 'calculationGet', 'requirementsFiles', 'requirementsGet', 'requirementsRecommend'])
function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(value))
}
async function inputOf(request) {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new McheError('请使用 JSON 请求')
  let size = 0; const chunks = []
  for await (const chunk of request) {
    size += chunk.length
    if (size > BODY_LIMIT) throw new McheError('输入超过 64 KB 限制', 413)
    chunks.push(chunk)
  }
  try { return JSON.parse(Buffer.concat(chunks)) } catch { throw new McheError('JSON 格式错误') }
}
export function createMcheHandler(service, ctx) {
  return async (request, response) => {
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff')
    const host = request.headers.host ?? ''
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host) || (request.headers.origin && request.headers.origin !== `http://${host}`)) return json(response, 403, { error: '仅支持本地同源访问' })
    try {
      const path = new URL(request.url, `http://${host}`).pathname
      const method = Object.hasOwn(methods, path.slice('/api/mche/'.length)) ? methods[path.slice('/api/mche/'.length)] : null
      if (request.method !== 'POST' || !method) return json(response, 404, { error: '接口不存在' })
      const input = await inputOf(request), workspace = ctx.get?.('liteWorkspace')
      if (!workspace) throw new McheError('会话归属服务不可用', 503)
      await (reads.has(method) ? workspace.requireRecord(input?.sessionId) : workspace.resumable(input?.sessionId))
      json(response, 200, await service[method](input, 'user'))
    } catch (error) {
      json(response, error.status ?? 400, { error: error.code === 'MCHE_INVALID' ? error.message : '方案请求失败，请核对会话归属和可编辑状态' })
    }
  }
}
