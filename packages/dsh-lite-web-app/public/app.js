import { createSidebar, api } from './sidebar.js'
import { createTableConversation } from './table-composer.js'
import { mountAttachments } from './attachment-composer.js'
import { encodeChatInput } from './table-message.js'
import { createConversationActionView } from './conversation-actions.js'
import { createDetailDrawer } from './detail-drawer.js'
import { streamRequest } from './chat-stream.js'
import { createChatView, count } from './chat-view.js'
const $ = (selector) => document.querySelector(selector)
const form = $('#form')
const prompt = $('#prompt')
const messages = $('#messages')
let sessionId
let busy = false
let expired = false
let mcheEditable = true
let defaultModel = ''
const sidebar = createSidebar({ open: openSession, fresh: newChat, projectChanged: loadModelPicker,
  canSwitch() {
    if (busy) return false
    if (hasUnsaved()) { showError('还有未发送的附件或表格，请先发送，或移除附件、放弃草稿。'); return false }
    if (!prompt.value.trim()) return true
    $('#error').textContent = '输入框还有未发送的内容，请先发送或清空后切换。'
    $('#error').hidden = false
    return false
  } })
const details = createDetailDrawer({ session: () => sessionId, writable: () => !busy && !expired && !prompt.value.trim(),
  mcheWritable: () => !busy && mcheEditable && !prompt.value.trim() })
const tableTools = createTableConversation({ messages, details, onError: showError,
  onSend: (tables) => sendMessage({ text: prompt.value.trim() || '请以我确认的这份表格继续对话。', tables }),
  onChange: updateHint })
const attachments = mountAttachments({ onError: showError, onChange: updateHint })
const actionView = createConversationActionView({ onDecide: decideAction, details })
const chatView = createChatView({ messages, tables: tableTools, details, onUsage: showSessionUsage })
const { addMessage, showUsage } = chatView
function hasUnsaved() { return tableTools.hasUnsaved() || attachments.hasFiles() || details.hasUnsaved() }
function updateHint() {
  $('#table-hint').textContent = hasUnsaved() ? '有待发送的附件或表格。点击发送后处理并保存到当前对话。' : '可粘贴表格或拖入 Excel/CSV；附件在发送时自动上传解析。'
}
function showError(text) { $('#error').textContent = text; $('#error').hidden = false }
prompt.addEventListener('paste', (event) => {
  const text = event.clipboardData?.getData('text/plain') ?? ''
  if (!busy && text.includes('\t') && text.includes('\n')) {
    event.preventDefault(); $('#welcome').hidden = true
    if (tableTools.extractPasted(text) === 'error') prompt.value = text
  }
})
window.addEventListener('beforeunload', (event) => {
  if (hasUnsaved()) { event.preventDefault(); event.returnValue = '' }
})

function setBusy(value) {
  if (!value) {
    const entry = $('#mche-entry')
    entry.replaceChildren()
    if (sessionId) entry.append(details.mche({ sessionId, view: 'requirements' }))
    details.prune()
  }
  busy = value
  details.setBusy()
  sidebar.setBusy(value)
  $('#send').disabled = value || expired
  actionView.setBusy(value, expired)
  attachments.setBusy(value, expired)
  tableTools.setBusy(value, expired)
  $('#new-chat').disabled = value
  $('#model-picker').disabled = value || Boolean(sessionId) || expired
  $('#model-picker-hint').textContent = sessionId ? '当前对话已固定模型；切换请新建对话。' : '仅用于本次新对话，不改变默认设置。'
  prompt.disabled = value
  $('#status').textContent = value ? '正在思考，请稍候…' : 'Enter 发送 · Shift + Enter 换行'
  messages.setAttribute('aria-busy', String(value))
}

function showSessionUsage(data) {
  const total = data.sessionUsage
  $('#token-total').textContent = count(total?.totalTokens)
  $('#mobile-token-total').textContent = `当前会话 Token：${count(total?.totalTokens)}${total?.complete ? '' : '（未完整上报）'}`
  $('#token-details').textContent = total?.reportedCalls ?
    `输入（非缓存）${count(total.inputTokens)} · 输出 ${count(total.outputTokens)}\n缓存命中 ${count(total.cacheReadTokens)}\n${total.reportedCalls}/${total.calls} 次模型调用已上报${total.complete ? '' : '（累计不完整）'}` :
    '服务商未提供 Token 用量。'
  if (data.model) {
    $('#model').textContent = data.model
    const value = JSON.stringify({ provider: data.provider, model: data.model })
    if (![...$('#model-picker').options].some((o) => o.value === value)) $('#model-picker').add(new Option(data.model, value))
    $('#model-picker').value = value
  }
  $('#conversation').scrollTop = $('#conversation').scrollHeight
}

form.addEventListener('submit', async (event) => {
  event.preventDefault()
  if (busy || expired) return
  if (details.hasUnsaved()) { showError('请先保存方案或计算输入草稿，再发送消息。'); return }
  let text = prompt.value.trim(), tables
  try { tables = tableTools.draftTables() } catch (error) { showError(error.message); return }
  if (!text && (tables.length || attachments.hasFiles())) text = '请阅读这些资料，并根据其中的数据与我继续对话。'
  if (!text) { showError('请输入问题、粘贴表格或添加附件。'); return }
  if (await sendMessage({ text, tables })) tableTools.clearDrafts()
})

async function sendMessage({ text, tables = [] }) {
  if (busy || expired) return false
  if (text.length > 8000) { showError('问题最多 8000 字，请缩短后发送'); return false }
  let user, pending, replyCompleted = false
  $('#error').hidden = true
  setBusy(true)
  try {
    if (attachments.hasFiles()) $('#status').textContent = '正在上传并解析附件…'
    const choice = !sessionId && $('#model-picker').value ? JSON.parse($('#model-picker').value) : undefined
    if (attachments.hasFiles() && !sessionId) {
      const prepared = await api('/api/session/prepare', { choice, projectId: sidebar.projectId() })
      sessionId = prepared.sessionId; sidebar.select(sessionId)
    }
    const workbooks = attachments.hasFiles() ? await attachments.collectWorkbooks({ sessionId }) : []
    const userText = encodeChatInput({ prompt: text, tables, workbooks })
    $('#welcome').hidden = true
    user = addMessage('user', userText)
    pending = addMessage('pending', '正在思考…')
    prompt.value = ''; $('#status').textContent = '正在思考，请稍候…'
    const data = await requestReply('/api/chat', { prompt: text, tables, workbooks, sessionId, projectId: sidebar.projectId(),
      choice: !sessionId && $('#model-picker').value ? JSON.parse($('#model-picker').value) : undefined }, pending)
    sessionId = data.sessionId
    renderReply(data, pending)
    replyCompleted = true
    if (data.tableWarning) showError(data.tableWarning)
    attachments.clear()
    sidebar.select(sessionId)
    await sidebar.refresh().catch(() => {})
    return true
  } catch (error) {
    if (error.sessionExpired) expired = true
    const received = chatView.fail(pending)
    if (!received) user?.remove()
    $('#welcome').hidden = messages.childElementCount > 0
    prompt.value = received ? '' : text
    $('#error').textContent = error instanceof TypeError ? '无法连接本地服务，请确认服务仍在运行。' : error.message
    $('#error').hidden = false
    return false
  } finally {
    setBusy(false)
    if (!replyCompleted || !chatView.openRequestedDetails(pending)) prompt.focus()
  }
}

function renderReply(data, message = addMessage('pending', '')) {
  actionView.render(chatView.complete(message, data), data.actions)
  details.prune()
  actionView.update(data.actionStates)
  showUsage(message, data)
}

function requestReply(url, input, pending) {
  return streamRequest(url, input, (event) => {
    if (event.type === 'session') { sessionId = event.sessionId; sidebar.select(sessionId) }
    else chatView.stream(pending, event)
  })
}

async function decideAction(action, decision) {
  if (busy || expired || !sessionId) return
  if (hasUnsaved() || prompt.value.trim()) { showError('请先发送或清空待发送内容，再确认对话中的建议。'); return }
  setBusy(true); $('#error').hidden = true
  details.close()
  const pending = addMessage('pending', '正在处理…')
  let replyCompleted = false
  $('#status').textContent = decision === 'confirm' ? `正在执行${action.title}…` : '正在记录你的选择…'
  try {
    const data = await requestReply('/api/actions/decide', { sessionId, id: action.id, decision }, pending)
    if (data.userMessage) pending.before(addMessage('user', data.userMessage))
    if (data.finalResponse) { renderReply(data, pending); replyCompleted = true }
    else pending.remove()
    actionView.update(data.actionStates)
    await sidebar.refresh().catch(() => {})
  } catch (error) {
    await openSession(sessionId).catch(() => {})
    showError(error.message)
  } finally {
    setBusy(false)
    if (!replyCompleted || !chatView.openRequestedDetails(pending)) prompt.focus()
  }
}

prompt.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    form.requestSubmit()
  }
})
async function newChat() {
  if (busy) return
  if (hasUnsaved()) { showError('还有未发送的附件或表格，请先发送，或移除附件、放弃草稿。'); return }
  if (sessionId) {
    setBusy(true)
    try { await api('/api/session/close', { sessionId }) }
    finally { setBusy(false) }
  }
  sessionId = undefined
  $('#model-picker').value = ''
  sidebar.select(undefined)
  expired = false
  mcheEditable = true
  setBusy(false)
  tableTools.reset(); actionView.reset(); details.reset(); messages.replaceChildren()
  $('#token-total').textContent = '—'
  $('#mobile-token-total').textContent = '当前会话 Token：—'
  $('#token-details').textContent = '发送消息后显示实际用量。'
  $('#welcome').hidden = false
  $('#error').hidden = true
  prompt.value = ''
  prompt.focus()
  void loadModelPicker()
}
$('#new-chat').addEventListener('click', () => {
  if (prompt.value.trim()) {
    $('#error').textContent = '请先发送或清空输入框，再新建对话。'; $('#error').hidden = false; return
  }
  newChat().catch((error) => { $('#error').textContent = error.message; $('#error').hidden = false })
})
async function openSession(id) {
  setBusy(true)
  try {
    const data = await api('/api/session/open', { sessionId: id })
    tableTools.reset(); actionView.reset(); details.reset(); messages.replaceChildren()
    sessionId = id
    expired = Boolean(data.readOnlyReason)
    mcheEditable = Boolean(data.mcheWritable)
    $('#welcome').hidden = data.messages.length > 0
    $('#error').hidden = !expired
    $('#error').textContent = data.readOnlyReason
    for (const item of data.messages) {
      const message = addMessage(item.role, item.role === 'assistant' ? '' : item.text)
      if (item.role === 'assistant') chatView.complete(message, { ...item, finalResponse: item.text })
      actionView.render(message.querySelector('.message-body'), item.actions)
      if (item.incomplete) { message.dataset.received = 'true'; chatView.fail(message) }
      if (item.role === 'assistant') showUsage(message, { ...data, usage: item.usage })
    }
    showSessionUsage(data)
    $('#model').textContent = data.model ?? '只读历史'
    sidebar.select(id, data.projectId)
  } finally { setBusy(false) }
}
document.querySelectorAll('[data-prompt]').forEach((button) => {
  button.addEventListener('click', () => {
    prompt.value = button.dataset.prompt
    prompt.focus()
  })
})
try {
  const response = await fetch('/api/status')
  if (!response.ok) throw new Error('服务不可用')
  const data = await response.json()
  $('#model').textContent = data.model
  defaultModel = data.model
  if (!data.configured) {
    $('#error').textContent = '当前模型尚未配置密钥，请打开“模型配置”进行设置。'
    $('#error').hidden = false
  }
} catch {
  $('#model').textContent = '服务未连接'
  $('#error').textContent = '无法连接本地服务，请重新启动后刷新页面。'
  $('#error').hidden = false
}

async function loadModelPicker() {
  if (sessionId || busy) return
  try {
    const response = await fetch('/api/model-config/state')
    if (!response.ok) return
    const state = await response.json()
    if (sessionId || busy) return
    const previous = $('#model-picker').value
    const providers = state.providers.filter((p) => p.baseURL || p.configuredModels.length || p.credential.configured || p.id === state.selected.provider)
    const options = providers.flatMap((provider) => provider.models.map((model) => {
      const option = new Option(`${provider.name} · ${model.id}${provider.credential.configured ? '' : '（未配置密钥）'}`,
        JSON.stringify({ provider: provider.id, model: model.id }))
      option.dataset.configured = String(provider.credential.configured)
      return option
    }))
    defaultModel = state.selected.model
    $('#model-picker').replaceChildren(new Option(`跟随项目 / 全局默认 · ${sidebar.defaultModel() ?? defaultModel}`, ''), ...options)
    const selected = options.some((option) => option.value === previous) ? previous : ''
    $('#model-picker').value = selected
    $('#model-picker-row').hidden = !options.length
    pickerChanged()
  } catch { /* 模型配置插件可选，不影响独立对话页面。 */ }
}
function pickerChanged() {
  const option = $('#model-picker').selectedOptions[0]
  if (!option || sessionId || busy) return
  if (!option.value) { $('#model').textContent = sidebar.defaultModel() ?? defaultModel; $('#error').hidden = true; return }
  $('#model').textContent = JSON.parse(option.value).model
  $('#error').hidden = option.dataset.configured === 'true'
  if (!$('#error').hidden) $('#error').textContent = '所选模型尚未配置密钥，请打开“模型配置”进行设置。'
}
$('#model-picker').addEventListener('change', pickerChanged)
await loadModelPicker()
await sidebar.init()
if (!sessionId) await loadModelPicker()
