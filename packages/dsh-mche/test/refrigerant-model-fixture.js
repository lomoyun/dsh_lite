const entry = (value, unit = '') => ({ value, unit, source: '用户提供的冷媒和部件选择条件' })
export function mockRefrigerantResponse(body) {
  const messages = body.messages ?? [], marker = /冷媒验收|冷媒追问|修改冷媒|冷媒表格|直接冷媒/
  const lastUser = messages.findLastIndex(m => m.role === 'user' && marker.test(JSON.stringify(m.content)))
  if (lastUser < 0) return null
  const prompt = JSON.stringify(messages[lastUser].content), results = messages.slice(lastUser + 1).filter(m => m.role === 'tool')
  const plan = /冷媒追问/.test(prompt) ? [['mche_case_get', {}], ['mche_prepare_calculation', {}]] :
    /直接冷媒/.test(prompt) ? [['refrigerant_get', { name: 'WATER' }], ['refrigerant_propose_selection', { name: 'WATER', reason: '用户直接指定水，原表未提供浓度' }]] :
    /修改冷媒/.test(prompt) ? [['mche_case_update_draft', { changes: { refrigerantConcentrationBasis: entry('mass') } }],
      ['refrigerant_recommend', { names: ['EG30Vol.', 'EG30Wt.'] }], ['refrigerant_propose_selection', { name: 'EG30Wt.', reason: '用户改为质量浓度30%，请独立确认' }]] : [
      ['mche_case_update_draft', { changes: { refrigerantCategory: entry('eg'), refrigerantConcentration: entry(30, '%'), refrigerantConcentrationBasis: entry('volume'),
        tubeLength: entry(500, 'mm'), tubeCount: entry(20, '个'), tubePitch: entry(10, 'mm') } }],
      ['tube_propose_selection', { name: 'A01S', reason: '用户指定扁管' }], ['fin_propose_selection', { name: 'B01', reason: '用户指定翅片' }],
      ['refrigerant_search', { category: 'eg', concentrationPercent: 30 }], ['refrigerant_get', { name: 'EG30Vol.' }],
      ['refrigerant_recommend', { names: ['EG30Vol.', 'EG30Wt.'] }], ['refrigerant_propose_selection', { name: 'EG30Vol.', reason: '按用户体积浓度30%的条件建议，等待用户确认' }],
    ]
  const step = plan[results.length]
  if (!step) return { delta: { role: 'assistant', content: '已查询冷媒库并保存建议，请点击“确认冷媒”核对标识、类别、浓度与来源。冷媒与扁管、翅片分别确认；物性和DLL映射尚未核实。' }, finishReason: 'stop' }
  return { delta: { role: 'assistant', tool_calls: [{ index: 0, id: `refrigerant-${results.length}`, type: 'function', function: { name: step[0], arguments: JSON.stringify(step[1]) } }] }, finishReason: 'tool_calls' }
}
