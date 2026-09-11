// 使用确定性本地模型驱动真实DSH工具循环；不验证外部模型提取准确率。
const value = (value, unit = 'mm') => ({ value, unit, source: '用户提供的扁管和翅片选型条件' })
export function mockFinResponse(body) {
  const messages = body.messages ?? [], marker = /翅片验收|翅片追问|修改翅片|翅片表格|直接翅片/
  const lastUser = messages.findLastIndex(m => m.role === 'user' && marker.test(typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
  if (lastUser < 0) return null
  const prompt = JSON.stringify(messages[lastUser].content), results = messages.slice(lastUser + 1).filter(m => m.role === 'tool')
  const plan = /翅片追问/.test(prompt) ? [['mche_case_get', {}], ['mche_prepare_calculation', {}]] :
    /修改翅片/.test(prompt) ? [['mche_case_update_draft', { changes: { finPitch: value(1.2) } }], ['fin_recommend', { names: ['B01', 'B02'] }],
      ['fin_propose_selection', { name: 'B02', reason: '按用户新的片距条件建议，等待用户确认' }]] :
    /直接翅片/.test(prompt) ? [['fin_get', { name: 'B150L' }], ['fin_propose_selection', { name: 'B150L', reason: '用户直接指定穿管翅片，保留未知列与单位依据' }]] : [
      ['mche_case_update_draft', { changes: { finSection: value('main', ''), finWidth: value(16), finHeightPostBrazing: value(8.1), finPitch: value(1.4),
        tubeLength: value(500), tubeCount: value(20, '个'), tubePitch: value(10) } }],
      ['tube_propose_selection', { name: 'A01S', reason: '用户指定扁管，装配匹配仍待核实' }],
      ['fin_search', { section: 'main', widthMm: 16, heightPostBrazingMm: 8.1, finPitchMm: 1.4 }],
      ['fin_get', { name: 'B01' }], ['fin_recommend', { names: ['B01', 'B02'] }],
      ['fin_propose_selection', { name: 'B01', reason: '按翅片草稿条件建议，点击蓝色链接核对后确认' }],
    ]
  const step = plan[results.length]
  if (!step) return { delta: { role: 'assistant', content: '已查询并比较翅片目录。请点击“确认翅片型号”核对，扁管和翅片分别确认并同时保存；装配匹配与DLL映射尚未验证。' }, finishReason: 'stop' }
  return { delta: { role: 'assistant', tool_calls: [{ index: 0, id: `fin-${results.length}`, type: 'function', function: { name: step[0], arguments: JSON.stringify(step[1]) } }] }, finishReason: 'tool_calls' }
}
