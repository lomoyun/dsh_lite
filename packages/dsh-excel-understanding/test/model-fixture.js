import XLSX from 'xlsx'
import { decodeChatInput } from '../../dsh-lite-web-app/public/table-message.js'

export function customerWorkbook() {
  const book = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet([['客户输入', null, null], [], ['型号', '00123'], ['温度', 12.5, '℃'], ['流量', '1,25', 'kg/s']])
  sheet.B6 = { t: 'n', v: 25, f: 'B4*2', z: '0.000' }; sheet['!ref'] = 'A1:C6'
  sheet['!merges'] = [XLSX.utils.decode_range('A1:C1')]
  sheet.B4.c = [{ a: '客户', t: '入口值' }]
  sheet['!rows'] = [null, { hidden: true }]
  XLSX.utils.book_append_sheet(book, sheet, '冷凝器')
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['说明'], ['☑ 铜管'], ['缺项', '请核对']]), '隐藏说明')
  book.Workbook = { Sheets: [{ Hidden: 0 }, { Hidden: 1 }] }
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' })
}
const textOf = (message) => typeof message.content === 'string' ? message.content : (message.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n')
function call(name, args, index) {
  return { delta: { role: 'assistant', content: index === 0 ? '我先检查全部 Sheet，再回查参数来源。' : null,
    tool_calls: [{ index: 0, id: `excel-call-${index}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, finishReason: 'tool_calls' }
}
export function mockExcelResponse(body) {
  const messages = body.messages
  const inputs = messages.filter((m) => m.role === 'user').map((m) => decodeChatInput(textOf(m)))
  const files = inputs.findLast((input) => input?.workbooks?.length)?.workbooks
  if (!files?.length) return null
  const fileId = files[0].fileId
  const latest = messages.findLastIndex((m) => m.role === 'user' && (decodeChatInput(textOf(m)) || textOf(m).includes('回查隐藏')))
  const calls = messages.slice(latest + 1).flatMap((m) => m.tool_calls ?? [])
  if (textOf(messages[latest]).includes('回查隐藏')) {
    if (!calls.length) return call('excel_read_range', { fileId, sheet: '隐藏说明', range: 'A1:B3' }, messages.length)
    return { delta: { role: 'assistant', content: '隐藏说明 A2 为“☑ 铜管”，字符不能证明控件勾选状态。' }, finishReason: 'stop' }
  }
  const steps = [
    ['excel_inspect', { fileId }],
    ['excel_read_range', { fileId, sheet: '冷凝器', range: 'A1:C6' }],
    ['excel_read_range', { fileId, sheet: '隐藏说明', range: 'A1:B3' }],
    ['excel_search', { fileId, query: '流量' }],
    ['excel_preview', { fileId, sheet: '冷凝器', range: 'A1:C6' }],
    ['excel_publish_understanding', { fileId, understanding: { schemaVersion: 1,
      overview: '客户输入包含型号、温度与流量；隐藏页补充材料说明。',
      coverage: [{ sheet: '冷凝器', purpose: '客户参数输入', ranges: ['A1:C6'] }, { sheet: '隐藏说明', purpose: '补充说明', ranges: ['A1:B3'] }],
      fields: [{ label: '流量', raw: '1,25', unit: 'kg/s', normalized: { kind: 'decimal_comma', value: 1.25 },
        explanation: '按小数逗号转换为候选数值，仍需用户确认。', evidence: [
          { fileId, sheet: '冷凝器', range: 'B5', quote: '1,25' }, { fileId, sheet: '冷凝器', range: 'C5', quote: 'kg/s' },
        ] }], issues: [{ kind: 'ambiguity', message: '隐藏页的勾选字符需视觉核对，不猜测正式必填数量。' }],
    } }],
  ]
  if (calls.length < steps.length) return call(...steps[calls.length], calls.length)
  return { delta: { role: 'assistant', content: '已读取两个 Sheet 并保存理解结果。流量原文为 1,25 kg/s，来源为冷凝器 B5:C5；规范化候选为 1.25，等待核对。隐藏页的勾选字符不能直接当作已确认控件状态。' }, finishReason: 'stop' }
}
