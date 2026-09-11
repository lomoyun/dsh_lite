import { streamingText } from './chat-stream.js'
const SCROLL_THRESHOLD = 160

export const count = (value) => value == null ? '未提供' : value.toLocaleString()
export function createChatView({ messages, tables, details, onUsage }) {
  const states = new WeakMap()
  function stateOf(message) {
    if (!states.has(message)) states.set(message, { segments: [], blocks: new Map(), tools: new Map(), running: new Set() })
    return states.get(message)
  }
  function status(message, value, text) {
    let badge = message.querySelector('.response-status')
    if (!badge) {
      badge = document.createElement('span'); badge.className = 'response-status'; badge.setAttribute('role', 'status')
      message.querySelector('.message-label').append(badge)
    }
    badge.dataset.state = value; badge.textContent = text
    message.dataset.responseState = value
    message.setAttribute('aria-busy', String(value === 'running'))
  }
  function addMessage(role, text) {
    const article = document.createElement('article'), label = document.createElement('div'), body = document.createElement('div')
    article.className = `message ${role}`; label.className = 'message-label'; body.className = 'message-body'
    label.textContent = role === 'user' ? '你' : 'DSH Lite'
    if (role !== 'pending') tables.render(body, text, role)
    article.append(label, body); messages.append(article); scroll()
    if (role === 'pending') status(article, 'running', '正在思考…')
    return article
  }
  function render(message, final = false) {
    const state = stateOf(message), body = message.querySelector('.message-body')
    if (!state.blocks.size) body.replaceChildren()
    const segments = state.segments.length ? state.segments : [{ id: 'fallback', text: final ? '本轮未返回文字。' : '' }]
    for (const part of segments) {
      let block = state.blocks.get(part.id)
      if (!block) {
        const element = document.createElement('div'), copy = document.createElement('span'), references = document.createElement('span')
        element.className = 'response-segment'; copy.className = 'response-copy'; references.className = 'tool-references'
        element.append(copy, references); body.append(element)
        block = { element, copy, references }; state.blocks.set(part.id, block)
      }
      if (block.text !== part.text || block.final !== final) {
        block.copy.replaceChildren()
        if (final) tables.render(block.copy, part.text.trimEnd(), 'assistant')
        else {
          const text = document.createElement('span'); text.className = 'message-text'
          text.textContent = streamingText(part.text).trimEnd(); block.copy.append(text)
        }
        block.text = part.text; block.final = final
      }
    }
    for (const { detail, button } of state.tools.values()) {
      const target = state.blocks.get(detail.afterText) ?? state.blocks.get(segments[0].id)
      if (button.parentNode !== target.references) target.references.append(button)
    }
    for (const [id, block] of state.blocks) {
      if (segments.some((part) => part.id === id)) continue
      block.element.remove(); state.blocks.delete(id)
    }
  }
  function rememberTool(state, detail) {
    if (!state.tools.has(detail.id)) state.tools.set(detail.id, { detail, button: details.tool(detail) })
    else state.tools.get(detail.id).detail = detail
    state.running.delete(detail.id)
  }
  function stream(message, event) {
    const state = stateOf(message)
    if (event.type === 'text') {
      state.segments = event.segments ?? [{ id: 'fallback', text: event.text }]
      message.dataset.received = 'true'
    }
    if (event.type === 'tool') { state.running.add(event.id); message.dataset.received = 'true' }
    if (event.type === 'detail') { rememberTool(state, event.detail); message.dataset.received = 'true' }
    if (!['text', 'tool', 'detail'].includes(event.type)) return
    render(message)
    status(message, 'running', state.running.size ? `工具处理中 · ${state.running.size} 项进行中` :
      event.type === 'detail' ? '工具已返回，正在整理回复…' : '正在回复…')
    scroll()
  }
  function complete(message, data) {
    message.className = 'message assistant'
    const state = stateOf(message)
    state.segments = data.segments?.length ? data.segments : [{ id: 'fallback', text: data.finalResponse || '本轮未返回文字。' }]
    const visible = data.details?.filter((item) => !data.actions?.some((a) => a.id === item.actionId)) ?? []
    for (const [id, item] of state.tools) if (!visible.some((detail) => detail.id === id)) {
      item.button.remove(); state.tools.delete(id)
    }
    for (const detail of visible) rememberTool(state, detail)
    render(message, true); state.running.clear()
    if (data.finishReason === 'max-tokens') status(message, 'incomplete', '回复已截断 · 达到输出上限')
    else if (data.incomplete) status(message, 'incomplete', '本轮未确认完成')
    else status(message, 'completed', '回复已完成')
    return message.querySelector('.message-body')
  }
  return { addMessage, stream, complete, openRequestedDetails(message) {
    const state = states.get(message)
    if (!state || state.openHandled) return false
    state.openHandled = true
    const request = [...state.tools.values()].findLast(({ detail }) => detail.status === 'completed' && detail.mche?.openEditor === true)
    return request ? details.openRequested(request.button, request.detail.mche) : false
  }, showUsage(message, data) {
    const row = document.createElement('div'), usage = data.usage
    row.className = 'token-usage'
    row.textContent = usage?.reportedCalls ? `本轮 Token · 输入（非缓存）${count(usage.inputTokens)} · 输出 ${count(usage.outputTokens)} · 合计 ${count(usage.totalTokens)}${usage.complete ? '' : '（部分上报）'}` : '本轮 Token · 服务商未提供用量'
    if (usage?.cacheReadTokens != null) row.textContent += ` · 缓存命中 ${count(usage.cacheReadTokens)}`
    if (usage?.cacheWriteTokens != null) row.textContent += ` · 缓存写入 ${count(usage.cacheWriteTokens)}`
    if (usage?.reasoningTokens != null) row.textContent += ` · 推理 ${count(usage.reasoningTokens)}`
    message.append(row); onUsage(data)
  }, fail(message) {
    if (!message?.dataset.received) { message?.remove(); return false }
    message.className = 'message assistant'
    status(message, 'incomplete', '本轮未确认完成')
    if (message.querySelector('.stream-incomplete')) return true
    const notice = document.createElement('p'); notice.className = 'stream-incomplete'
    notice.textContent = '本轮未确认完成，以上为已收到的部分内容。重新打开对话可核对最终状态。'
    message.append(notice); return true
  } }
}

function scroll() {
  const conversation = document.querySelector('#conversation')
  if (conversation.scrollHeight - conversation.scrollTop - conversation.clientHeight < SCROLL_THRESHOLD) conversation.scrollTop = conversation.scrollHeight
}
