export const $ = (id) => document.getElementById(id)
export const presets = {
  deepseek: { url: 'https://api.deepseek.com', api: 'openai-completions', model: 'deepseek-v4-flash' },
  openai: { url: 'https://api.openai.com/v1', api: 'openai-completions', model: '' },
  anthropic: { url: 'https://api.anthropic.com', api: 'anthropic-messages', model: '' },
  local: { url: 'http://127.0.0.1:11434/v1', api: 'openai-completions', model: '' },
}
export function notice(message, error = false) {
  $('notice').textContent = message
  $('notice').className = error ? 'error' : ''
}
function element(tag, text, className) {
  const node = document.createElement(tag)
  node.textContent = text
  if (className) node.className = className
  return node
}
export function sidebar(state, viewing, choose) {
  const saved = state.providers.filter((p) => p.baseURL || p.configuredModels.length || p.credential.configured || p.id === state.selected.provider)
  $('config-count').textContent = saved.length
  $('config-list').replaceChildren(...saved.map((p) => {
    const button = element('button', '', 'config-item')
    button.type = 'button'
    button.setAttribute('aria-current', String(p.id === viewing))
    const copy = element('span', '', 'config-copy')
    copy.append(element('strong', p.name), element('small', p.id === state.selected.provider ? `默认 · ${state.selected.model}` : `${p.models.length} 个模型 · ${p.credential.configured ? '密钥已配置' : '待配置密钥'}`))
    const icon = element('span', p.name.slice(0, 1).toUpperCase(), 'connection-icon')
    icon.setAttribute('aria-hidden', 'true')
    button.append(icon, copy)
    button.addEventListener('click', () => choose(p.id))
    return button
  }))
}
export function connection(p) {
  $('connection-title').textContent = p ? p.name : '添加连接'
  $('connection-state').textContent = p ? '已保存' : '新连接'
  $('connection-name').value = p?.name ?? ''
  $('connection-name').readOnly = p?.namespace === 'llm-deepseek'
  $('provider-id').value = p?.id ?? ''
  $('base-url').value = p?.baseURL || presets.deepseek.url
  $('protocol').value = p ? p.api || '' : presets.deepseek.api
  $('protocol').disabled = p?.namespace === 'llm-deepseek'
  $('service-type').value = p?.api === 'anthropic-messages' ? 'anthropic' :
    /localhost|127\.0\.0\.1/.test(p?.baseURL ?? '') ? 'local' : p && !/deepseek/.test(p.baseURL || p.id) ? 'openai' : 'deepseek'
  $('service-type').disabled = Boolean(p)
  $('key-ref').value = p?.apiKeyEnv ?? ''
  $('api-key').value = ''
  $('credential-status').textContent = p?.credential.configured ?
    p.credential.writable ? '已配置 · 留空保留原密钥' : '启动环境提供 · 替换需更换高级设置中的引用' : '尚未配置 · 可先保存连接，稍后补充密钥'
  $('first-model-row').hidden = Boolean(p)
  $('first-model').required = !p
  $('first-model').value = p ? '' : presets.deepseek.model
  $('models-section').hidden = !p
  $('advanced').open = false
}
export function modelList(state, p, callbacks) {
  if (!p) return
  const models = p.models.map((m) => ({ ...m, ...p.configuredModels.find((item) => item.id === m.id) }))
  $('model-list').replaceChildren(...models.map((model) => {
    const row = element('div', '', 'model-row')
    const info = element('div', '', 'model-info')
    const limit = state.modelLimits?.find((item) => item.provider === p.id && item.model === model.id)?.maxTokens
    info.append(element('strong', model.id), element('small', `上下文 ${model.contextWindow?.toLocaleString() ?? '适配器默认'} · 请求输出上限 ${limit?.toLocaleString() ?? '沿用现有设置'}`))
    const edit = element('button', '编辑')
    edit.type = 'button'; edit.setAttribute('aria-label', `编辑 ${model.id}`)
    edit.addEventListener('click', () => callbacks.edit(model))
    const isDefault = p.id === state.selected.provider && model.id === state.selected.model
    const activate = element('button', isDefault ? '默认模型 ✓' : '设为默认')
    activate.type = 'button'; activate.disabled = isDefault
    activate.setAttribute('aria-label', `${isDefault ? '当前默认' : '设为默认'} ${model.id}`)
    activate.addEventListener('click', () => callbacks.activate(model.id))
    row.append(info, edit, activate)
    return row
  }))
  if (!models.length) $('model-list').append(element('p', '暂无模型，点击“添加模型”开始。', 'empty'))
}
