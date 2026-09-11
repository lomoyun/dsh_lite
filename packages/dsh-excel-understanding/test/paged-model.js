import XLSX from 'xlsx'
import { decodeChatInput } from '../../dsh-lite-web-app/public/table-message.js'

export const SHEET = 'Heat Pump Inputs'
const textOf = (message) => typeof message.content === 'string' ? message.content : (message.content ?? []).filter((part) => part.type === 'text').map((part) => part.text).join('')
export function denseWorkbook() {
  const rows = Array.from({ length: 74 }, (_, r) => Array.from({ length: 14 }, (_, c) => `参数${r}_${c} 客户资料和说明 `.repeat(3)))
  rows[32][0] = 'Refrigerant side pressure drop limit'; rows[32][1] = 'psid'; rows[32][3] = 10
  const sheet = XLSX.utils.aoa_to_sheet(rows), book = XLSX.utils.book_new()
  sheet.D33.z = '0.0'; XLSX.utils.book_append_sheet(book, sheet, SHEET)
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' })
}
export function understanding(fileId) {
  return { schemaVersion: 1, overview: '蒸发器客户表分页来源回归', coverage: [{ sheet: SHEET, purpose: '客户输入', ranges: ['A1:N74'] }],
    fields: [{ label: '制冷剂侧压降上限', raw: 10, unit: 'psid', evidence: [
      { fileId, sheet: SHEET, range: 'D33', quote: '10.0' }, { fileId, sheet: SHEET, range: 'B33', quote: 'psid' },
    ] }], issues: [] }
}
export function pagedModel(body) {
  const files = body.messages.filter((message) => message.role === 'user').map((message) => decodeChatInput(textOf(message)))
    .findLast((input) => input?.workbooks?.length)?.workbooks
  if (!files) return null
  const fileId = files[0].fileId, calls = body.messages.flatMap((message) => message.tool_calls ?? [])
  const results = body.messages.filter((message) => message.role === 'tool').map((message) => {
    try { return JSON.parse(textOf(message)) } catch { return null }
  }).filter(Boolean)
  const call = (name, args) => ({ delta: { role: 'assistant', tool_calls: [{ index: 0, id: `paged-${calls.length}`, type: 'function',
    function: { name, arguments: JSON.stringify(args) } }] }, finishReason: 'tool_calls' })
  const publish = () => {
    const data = understanding(fileId)
    if (!body.messages.some((message) => message.role === 'tool' && textOf(message).includes('EXCEL_QUOTE_MISMATCH'))) {
      data.issues.push({ kind: 'unchecked', message: '视觉核验需确认', evidence: [
        { fileId, sheet: SHEET, range: 'A1:N74', quote: 'Customer Requirement Definition for evaporator design' },
      ] })
    }
    return call('excel_publish_understanding', { fileId, understanding: data })
  }
  if (!calls.length) return call('excel_inspect', { fileId })
  if (calls.length === 1) return publish()
  const pending = ['A1:N74']
  for (const result of results.filter((result) => result.readVersion === 2)) { pending.shift(); pending.unshift(...result.nextRanges) }
  if (pending.length) return call('excel_read_range', { fileId, sheet: SHEET, range: pending[0] })
  if (!calls.some((item) => item.function.name === 'excel_preview')) return call('excel_preview', { fileId, sheet: SHEET, range: 'A1:N74' })
  if (!results.some((result) => result.resultId)) return publish()
  return { delta: { role: 'assistant', content: '已按页读取并发布，压降上限为 10 psid；视觉核验状态见结果。' }, finishReason: 'stop' }
}
