import { createUserMessage } from '@deepseek-ai/dsh-llm'

export const ACTION_TOOL = 'propose_conversation_action'
const ACTION_SOURCE = 'conversation-actions'
const STATE_PREFIX = '【对话操作状态 v1】\n'
const terminal = new Set(['completed', 'failed', 'dismissed'])

export function appendActionState(agent, state) {
  agent.session.append('user/message', createUserMessage({
    source: { kind: 'plugin', plugin: ACTION_SOURCE, form: 'notice', summary: '对话操作状态已更新' },
    content: [{ type: 'text', text: `${STATE_PREFIX}${JSON.stringify(state)}` }],
  }), { surfaceOp: 'append' })
}

function stateOf(event) {
  const source = event.data.source
  if (event.type !== 'user/message' || source?.kind !== 'plugin' || source.plugin !== ACTION_SOURCE) return null
  const text = event.data.content?.[0]?.text
  if (!text?.startsWith(STATE_PREFIX)) return null
  try { return JSON.parse(text.slice(STATE_PREFIX.length)) } catch { return null }
}

// 只信任原生工具结果及服务端写入的状态事件；不从助手文字提取可执行指令。
export function projectActions(events) {
  const actions = new Map(), calls = new Map()
  let turnActions = [], lastAssistant
  for (const [index, event] of events.entries()) {
    if (event.type === 'user/message' && event.data.source?.kind === 'user') {
      for (const action of actions.values()) if (action.status === 'pending') action.status = 'stale'
    }
    if (event.type === 'assistant/message') lastAssistant = event.seq
    if (event.type === 'tool/call') calls.set(event.data.callId, event.data.name)
    const proposal = proposalOf(event, calls)
    if (proposal && !actions.has(proposal.id)) {
      actions.set(proposal.id, { ...proposal, status: 'pending', eventIndex: index })
      turnActions.push(proposal.id)
    }
    const state = stateOf(event)
    if (state) applyState(actions, state)
    if (event.type !== 'turn/end') continue
    for (const id of turnActions) {
      const action = actions.get(id)
      action.anchorSeq = lastAssistant
      if (!['completed', 'max-tokens'].includes(event.data.reason?.kind)) action.status = 'stale'
    }
    turnActions = []; lastAssistant = undefined
  }
  for (const id of turnActions) actions.get(id).status = 'stale'
  return [...actions.values()]
}

function proposalOf(event, calls) {
  if (event.type !== 'tool/result') return null
  const result = event.data.message?.content?.find((block) => block.type === 'tool-result')
  if (!result || result.isError || calls.get(result.toolCallId) !== ACTION_TOOL) return null
  const value = event.data.meta?.conversationAction
  if (!value || !['id', 'action', 'title', 'reason', 'effect', 'confirmLabel'].every((key) => typeof value[key] === 'string')) return null
  return value
}

function applyState(actions, data) {
  const action = actions.get(data.id)
  if (!action || terminal.has(action.status)) return
  if (action.status === 'pending' && ['executing', 'dismissed'].includes(data.status)) action.status = data.status
  else if (action.status === 'executing' && ['completed', 'failed'].includes(data.status)) action.status = data.status
}
