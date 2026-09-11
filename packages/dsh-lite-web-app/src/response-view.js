import { summarizeUsage } from './usage.js'
import { projectActions, ACTION_TOOL } from './action-history.js'

const DETAIL_LIMIT = 20000
export const textOf = (message) => (message?.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('')
const resultText = (content) => typeof content === 'string' ? content : textOf({ content: Array.isArray(content) ? content : [] })

export function toolDetail(event, calls) {
  if (event.type === 'tool/call') { calls.set(event.data.callId, event.data.name); return null }
  if (event.type !== 'tool/result') return null
  const result = event.data.message?.content?.find((b) => b.type === 'tool-result')
  const name = calls.get(result?.toolCallId)
  if (!name) return null
  let failed = Boolean(result.isError)
  try { failed ||= JSON.parse(resultText(result.content))?.ok === false } catch { /* Non-JSON tool output keeps the transport status. */ }
  const action = name === ACTION_TOOL && !failed ? event.data.meta?.conversationAction : null
  const text = action ? `${action.reason}\n\n${action.effect}\n\n这是操作建议，执行状态请查看对话中的确认卡片。` :
    resultText(result.content)
  const excelTitles = { excel_inspect: '查看工作簿概览', excel_read_range: '查看读取区域', excel_search: '查看检索来源',
    excel_preview: '查看原始预览', excel_publish_understanding: '查看 Excel 理解结果' }
  const mcheTitles = { mche_case_get: '查看当前MCHE方案', mche_case_update_draft: '核对部件输入', tube_search: '查看扁管候选',
    tube_get: '查看型号尺寸与来源', tube_recommend: '比较扁管候选', tube_propose_selection: '查看扁管选型建议', mche_prepare_calculation: '查看部件参数准备',
    fin_search: '查看翅片候选', fin_get: '查看翅片尺寸与来源', fin_recommend: '比较翅片候选', fin_propose_selection: '查看翅片选型建议',
    refrigerant_search: '查看冷媒候选', refrigerant_get: '查看冷媒数据与来源', refrigerant_recommend: '比较冷媒候选', refrigerant_propose_selection: '查看冷媒选型建议',
    mche_calculation_open_editor: '打开流向与拓扑编辑器',
    mche_calculation_profile_get: '查看计算范围与缺项', mche_calculation_update_draft: '查看计算草稿',
    mche_calculate: '查看计算任务', mche_calculation_get: '查看计算进度与结果', mche_calculation_cancel: '查看计算取消状态',
    mche_requirements_files: '查看需求来源', mche_requirements_read: '核对客户需求', mche_requirements_get: '查看客户需求',
    mche_requirements_update_draft: '核对需求草稿', mche_requirements_recommend_boundary: '查看 Boundary 建议' }
  return { id: result.toolCallId, title: action ? `操作建议：${action.title}` : mcheTitles[name] ?? excelTitles[name] ?? `工具结果：${name}`,
    actionId: action?.id, excel: !failed ? event.data.meta?.excel : undefined,
    mche: !failed ? event.data.meta?.mche : undefined,
    status: failed ? 'failed' : 'completed', text: text.slice(0, DETAIL_LIMIT), truncated: text.length > DETAIL_LIMIT }
}

export function responseOf(events) {
  const calls = new Map(), details = [], texts = new Map(), anchors = new Map()
  for (const event of events) {
    if (event.type === 'assistant/message') texts.set(textKey(event), textOf(event.data.message))
    if (event.type === 'tool/call') anchors.set(event.data.callId, lastText(texts))
    const detail = toolDetail(event, calls)
    if (detail) details.push({ ...detail, afterText: anchors.get(detail.id) })
  }
  return { finalResponse: joinedText(texts), segments: segmentsOf(texts), details,
    finishReason: events.findLast((e) => e.type === 'turn/end')?.data.reason?.kind }
}

const textKey = (event) => `${event.data.turn}:${event.data.step}`
const segmentsOf = (texts) => [...texts].filter(([, text]) => text).map(([id, text]) => ({ id, text }))
const joinedText = (texts) => segmentsOf(texts).map((part) => part.text).join('\n\n')
const lastText = (texts) => segmentsOf(texts).at(-1)?.id

export function historyOf(events) {
  const messages = [], actionStates = projectActions(events)
  let turn = []
  function flush() {
    if (!turn.length) return
    const response = responseOf(turn)
    const seqs = new Set(turn.filter((e) => e.type === 'assistant/message').map((e) => e.seq))
    const actions = actionStates.filter((a) => seqs.has(a.anchorSeq))
    const end = turn.findLast((e) => e.type === 'turn/end')
    if (response.finalResponse || response.details.length || actions.length) messages.push({ role: 'assistant',
      text: response.finalResponse, segments: response.segments, finishReason: response.finishReason,
      details: response.details, actions, usage: summarizeUsage(turn),
      incomplete: !['completed', 'max-tokens'].includes(end?.data.reason?.kind) })
    turn = []
  }
  for (const event of events) {
    const user = event.type === 'user/message' && event.data.source?.kind === 'user'
    if (user || event.type === 'turn/start') flush()
    if (user) { messages.push({ role: 'user', text: textOf(event.data), actions: [] }); continue }
    const previous = turn.find((e) => e.type === 'assistant/message')
    if (event.type === 'assistant/message' && previous && previous.data.turn !== event.data.turn) flush()
    turn.push(event)
    if (event.type === 'turn/end') flush()
  }
  flush()
  return messages
}

// 仅订阅当前会话的公开正文和工具结果，不转发推理、请求头或工具参数分片。
export function streamTurn(ctx, agent, onEvent) {
  if (!onEvent) return () => {}
  const texts = new Map(), calls = new Map(), anchors = new Map()
  onEvent({ type: 'session', sessionId: agent.id })
  return ctx.on?.('session/event', (session, event) => {
    if (session.id !== agent.id) return
    const key = textKey(event)
    const chunk = event.data.chunk
    if (event.type === 'assistant/chunk' && chunk?.type === 'text-delta') {
      texts.set(key, (texts.get(key) ?? '') + chunk.text)
      onEvent({ type: 'text', text: joinedText(texts), segments: segmentsOf(texts) })
    }
    if (event.type === 'assistant/message') {
      texts.set(key, textOf(event.data.message))
      onEvent({ type: 'text', text: joinedText(texts), segments: segmentsOf(texts) })
    }
    if (event.type === 'tool/call') {
      anchors.set(event.data.callId, lastText(texts))
      onEvent({ type: 'tool', id: event.data.callId, status: 'running' })
    }
    const detail = toolDetail(event, calls)
    if (detail) onEvent({ type: 'detail', detail: { ...detail, afterText: anchors.get(detail.id) } })
  }) ?? (() => {})
}
