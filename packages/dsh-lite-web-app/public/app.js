import { createSidebar, api } from './sidebar.js'
const $ = (selector) => document.querySelector(selector)
const form = $('#form')
const prompt = $('#prompt')
const messages = $('#messages')
let sessionId
let busy = false
let expired = false
let defaultModel = ''
const sidebar = createSidebar({ open: openSession, fresh: newChat, projectChanged: loadModelPicker,
  canSwitch() {
    if (busy) return false
    if (!prompt.value.trim()) return true
    $('#error').textContent = '输入框还有未发送的内容，请先发送或清空后切换。'
    $('#error').hidden = false
    return false
  } })

function addMessage(role, text) {
  const article = document.createElement('article')
  article.className = `message ${role}`
  const label = document.createElement('div')
  label.className = 'message-label'
  label.textContent = role === 'user' ? '你' : 'DSH Lite'
  const body = document.createElement('div')
  body.className = 'message-body'
  body.textContent = text
  article.append(label, body)
  messages.append(article)
  $('#conversation').scrollTop = $('#conversation').scrollHeight
  return article
}

function setBusy(value) {
  busy = value
  sidebar.setBusy(value)
  $('#send').disabled = value || expired
  $('#new-chat').disabled = value
  $('#model-picker').disabled = value || Boolean(sessionId) || expired
  $('#model-picker-hint').textContent = sessionId ? '当前对话已固定模型；切换请新建对话。' : '仅用于本次新对话，不改变默认设置。'
  prompt.disabled = value || expired
  $('#status').textContent = value ? '正在思考，请稍候…' : 'Enter 发送 · Shift + Enter 换行'
  messages.setAttribute('aria-busy', String(value))
}

const count = (value) => value === null || value === undefined ? '未提供' : value.toLocaleString()
function showUsage(message, data) {
  const row = document.createElement('div')
  row.className = 'token-usage'
  const usage = data.usage
  row.textContent = usage?.reportedCalls ? `本轮 Token · 输入（非缓存）${count(usage.inputTokens)} · 输出 ${count(usage.outputTokens)} · 合计 ${count(usage.totalTokens)}${usage.complete ? '' : '（部分上报）'}` : '本轮 Token · 服务商未提供用量'
  if (usage?.cacheReadTokens != null) row.textContent += ` · 缓存命中 ${count(usage.cacheReadTokens)}`
  if (usage?.cacheWriteTokens != null) row.textContent += ` · 缓存写入 ${count(usage.cacheWriteTokens)}`
  if (usage?.reasoningTokens != null) row.textContent += ` · 推理 ${count(usage.reasoningTokens)}`
  message.append(row)
  showSessionUsage(data)
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
  const text = prompt.value.trim()
  if (busy || expired || !text) return
  $('#welcome').hidden = true
  $('#error').hidden = true
  const user = addMessage('user', text)
  const pending = addMessage('pending', '正在思考…')
  prompt.value = ''
  setBusy(true)
  try {
    const response = await fetch('/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: text, sessionId, projectId: sidebar.projectId(), choice: !sessionId && $('#model-picker').value ? JSON.parse($('#model-picker').value) : undefined }),
    })
    const data = await response.json()
    if (data.sessionExpired) expired = true
    if (!response.ok) throw new Error(data.error || '请求失败，请稍后再试')
    sessionId = data.sessionId
    pending.remove()
    showUsage(addMessage('assistant', data.finalResponse || '本轮未返回文字，请尝试换一种问法。'), data)
    sidebar.select(sessionId)
    await sidebar.refresh().catch(() => {})
  } catch (error) {
    pending.remove()
    user.remove()
    $('#welcome').hidden = messages.childElementCount > 0
    prompt.value = text
    $('#error').textContent = error instanceof TypeError ? '无法连接本地服务，请确认服务仍在运行。' : error.message
    $('#error').hidden = false
  } finally {
    setBusy(false)
    prompt.focus()
  }
})

prompt.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    form.requestSubmit()
  }
})
async function newChat() {
  if (busy) return
  if (sessionId) {
    setBusy(true)
    try { await api('/api/session/close', { sessionId }) }
    finally { setBusy(false) }
  }
  sessionId = undefined
  $('#model-picker').value = ''
  sidebar.select(undefined)
  expired = false
  setBusy(false)
  messages.replaceChildren()
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
    messages.replaceChildren()
    sessionId = id
    expired = Boolean(data.readOnlyReason)
    $('#welcome').hidden = data.messages.length > 0
    $('#error').hidden = !expired
    $('#error').textContent = data.readOnlyReason
    for (const item of data.messages) {
      const message = addMessage(item.role, item.text)
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
