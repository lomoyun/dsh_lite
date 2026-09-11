// Local deterministic model for protocol tests, never an external model accuracy claim.
import { decodeChatInput } from '../../dsh-lite-web-app/public/table-message.js'

export function mockRequirementsResponse(body) {
  const messageText = m => typeof m.content === 'string' ? m.content : (m.content ?? []).filter(b => b.type === 'text').map(b => b.text).join('\n')
  const messages = body.messages ?? [], start = messages.findLastIndex(m => m.role === 'user' && /^需求表(?:验收|追问|改温)/.test(messageText(m)))
  if (start < 0) return null
  const prompt = JSON.stringify(messages[start].content), results = messages.slice(start+1).filter(m => m.role === 'tool').map(m => {
    // Compaction can replace even a current result. Re-query below; never parse a
    // clipped JSON fragment or treat it as a complete Profile.
    if (m.content.includes('[... tool result middle pruned ...]')) return { pruned: true }
    try { return JSON.parse(m.content) }
    catch (error) { throw new Error(`Fixture tool ${m.tool_call_id} returned non-JSON (${m.content.length} chars): ${m.content.slice(4020, 4380)}`, { cause: error }) }
  })
  let step
  if (/需求表改温/.test(prompt)) {
    const calls = messages.slice(start+1).flatMap(m => m.tool_calls ?? []).map(c => c.function.name)
    const current = results.findLast(r => r.requirements)
    if (!calls.includes('mche_requirements_update_draft') && !current) step = ['mche_requirements_get', {}]
    else if (!calls.includes('mche_requirements_update_draft')) step = ['mche_requirements_update_draft', { revision: current.revision, edits: {
      'refTemperature:D6': { value: 84, unit: '°C', source: '用户需求表改温：冷媒入口温度改为84°C' },
    } }]
    else if (!results.at(-1)?.profileDraft) step = ['mche_calculation_profile_get', {}]
  }
  else if (/需求表追问/.test(prompt)) step = !results.length || results.at(-1)?.pruned ? ['mche_requirements_get', {}] : null
  else if (!results.length) {
    const file = decodeChatInput(messageText(messages[start]))?.workbooks?.[0]
    const notice = messages.slice(0, start).flatMap(m => messageText(m).split('\n')).findLast(line => line.startsWith('{"revision":'))
    if (!file || !notice) throw new Error('首轮缺少服务端文件引用或 MCHE revision 通知')
    step = ['mche_requirements_read', { fileId: file.fileId, revision: JSON.parse(notice).revision }]
  }
  if (!step) {
    const profile = results.at(-1)?.profileDraft ?? results.at(-1)?.requirements?.profileDraft
    const sh = profile?.sections.find(s => s.id === 'inlet')?.fields.find(f => f.key === 'refSuperheat')?.entry
    return { delta: { role: 'assistant', content: `已读取26条有值需求，SH=${sh?.normalized ?? '待核'} K。推荐入口 P&T＋出口 SC，PTM仍缺质量流量。主工况空气32°C与测试42°C分别保留；90°?待核。请在客户需求页核对当前输入。` }, finishReason: 'stop' }
  }
  return { delta: { role: 'assistant', tool_calls: [{ index: 0, id: `requirements-${results.length}`, type: 'function', function: { name: step[0], arguments: JSON.stringify(step[1]) } }] }, finishReason: 'tool_calls' }
}
