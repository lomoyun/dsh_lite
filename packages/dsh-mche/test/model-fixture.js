// 本地确定性模型，仅验证真实 Agent 是否自主调用注册工具，不代表外部模型提取准确率。
import { mockFinResponse } from './fin-model-fixture.js'
import { mockRefrigerantResponse } from './refrigerant-model-fixture.js'
const entry = (value, unit) => ({ value, unit, source: '用户提供：管宽16mm、管高1.8mm、管长500mm、管数20、管间距10mm' })
export function mockMcheResponse(body) {
  const refrigerantReply = mockRefrigerantResponse(body)
  if (refrigerantReply) return refrigerantReply
  const finReply = mockFinResponse(body)
  if (finReply) return finReply
  const messages = body.messages ?? [], lastUser = messages.findLastIndex((item) => item.role === 'user' && /扁管验收|扁管追问|直接型号|修改扁管|扁管表格/.test(typeof item.content === 'string' ? item.content : JSON.stringify(item.content)))
  const prompt = typeof messages[lastUser]?.content === 'string' ? messages[lastUser].content : JSON.stringify(messages[lastUser]?.content)
  if (!/扁管验收|扁管追问|直接型号|修改扁管|扁管表格/.test(prompt ?? '')) return null
  const results = messages.slice(lastUser + 1).filter((item) => item.role === 'tool')
  const plan = /扁管追问/.test(prompt) ? [['mche_case_get', {}], ['mche_prepare_calculation', {}]] :
    /直接型号/.test(prompt) ? [['tube_get', { name: 'A010S' }], ['tube_propose_selection', { name: 'A010S', reason: '用户直接指定' }]] :
    /修改扁管/.test(prompt) ? [['mche_case_update_draft', { changes: { tubeWidth: entry(25.4, 'mm') } }], ['tube_recommend', { names: ['A01S', 'A192S1'] }]] : [
      ['mche_case_update_draft', { changes: { tubeWidth: entry(16, 'mm'), tubeHeight: entry(1.8, 'mm'),
        tubeLength: entry(500, 'mm'), tubeCount: entry(20, '个'), tubePitch: entry(10, 'mm') } }],
      ['tube_search', { widthMm: { min: 15, max: 16 }, heightMm: 1.8 }],
      ['tube_get', { name: 'A01S' }], ['tube_recommend', { names: ['A01S', 'A192S1'] }],
      ['tube_propose_selection', { name: 'A01S', reason: '按用户草稿尺寸建议，待用户确认输入和型号' }],
    ]
  const step = plan[results.length]
  if (!step) return { delta: { role: 'assistant', content: '已按当前条件查阅扁管目录。草稿及型号建议可点击蓝色链接核对；参数准备仍会列出 DLL 映射阻塞。' }, finishReason: 'stop' }
  return { delta: { role: 'assistant', tool_calls: [{ index: 0, id: `mche-${results.length}`, type: 'function',
    function: { name: step[0], arguments: JSON.stringify(step[1]) } }] }, finishReason: 'tool_calls' }
}
