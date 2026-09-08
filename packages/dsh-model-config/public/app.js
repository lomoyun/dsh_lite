import { $, presets, notice, sidebar, connection, modelList } from './views.js'
let state
let viewing
let busy = false
let dirty = false
let modelDirty = false
const existing = () => state?.providers.find((p) => p.id === viewing)

async function request(action, input) {
  const response = await fetch(`/api/model-config/${action}`, input ? {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  } : {})
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || '请求失败，请稍后重试')
  return data
}
function setDirty(value) {
  dirty = value
  $('discard').hidden = !value
}
function render() {
  const p = existing()
  const saved = state.providers.filter((p) => p.baseURL || p.configuredModels.length || p.credential.configured || p.id === state.selected.provider)
  $('provider').replaceChildren(...saved.map((item) => new Option(item.name, item.id)), new Option('＋ 添加连接', '__new__'))
  $('provider').value = viewing
  $('current-model').textContent = state.selected.model
  $('current-provider').textContent = `${state.providers.find((item) => item.id === state.selected.provider)?.name || state.selected.provider} · 输出上限 ${state.selected.maxTokens.toLocaleString()}`
  sidebar(state, viewing, choose)
  connection(p)
  modelList(state, p, { edit: openModel, activate })
  $('add-config').disabled = state.providerRevision === null
}
async function load(preferred) {
  state = await request('state')
  viewing = preferred || state.selected.provider
  render()
}
function choose(id) {
  if (busy || id === viewing) { $('provider').value = viewing; return }
  if (dirty) { $('provider').value = viewing; notice('请先保存连接或放弃未保存修改。', true); return }
  viewing = id
  $('catalog-options').replaceChildren()
  render()
  notice(id === '__new__' ? '填写连接名称、地址和首个模型即可保存；内部 ID 自动生成。' : '正在查看连接，默认模型未改变。')
}
async function perform(work) {
  if (busy) return
  busy = true
  $('connection-form').inert = true
  $('model-form').inert = true
  $('models-section').inert = true
  $('model-error').textContent = ''
  notice('正在处理…')
  try { await work() }
  catch (error) {
    const message = error instanceof TypeError ? '无法连接本地服务，请检查服务后重试。' : error.message
    notice(message, true)
    if ($('model-dialog').open) $('model-error').textContent = message
  } finally {
    busy = false
    $('connection-form').inert = false
    $('model-form').inert = false
    $('models-section').inert = false
  }
}
function requireSaved() {
  if (dirty) { notice('请先保存连接或放弃未保存修改。', true); return false }
  return Boolean(existing()) && !busy
}
function openModel(model) {
  if (!requireSaved()) return
  const limit = state.modelLimits.find((item) => item.provider === viewing && item.model === model?.id)
  $('dialog-title').textContent = model ? '编辑模型' : '添加模型'
  $('model-id').value = model?.id ?? ''
  $('model-id').readOnly = Boolean(model)
  $('context-window').value = model?.contextWindow ?? 131072
  $('model-max').value = limit?.maxTokens ?? (model ? state.selected.maxTokens : 8192)
  $('model-error').textContent = ''
  modelDirty = false
  $('model-dialog').showModal()
}
function activate(model) {
  if (!requireSaved()) return
  void perform(async () => {
    await request('selection', { provider: viewing, model, revision: state.revision })
    await load(viewing)
    notice('默认模型已更新，新建对话后生效；已有对话继续使用原模型。')
  })
}
$('connection-form').addEventListener('submit', (event) => {
  event.preventDefault()
  if (!state) return
  if (viewing !== '__new__' && !existing()) {
    notice('连接已创建，但状态尚未刷新。请重新加载后继续，避免重复创建。', true)
    return
  }
  void perform(async () => {
    const p = existing()
    const key = $('api-key').value
    const result = await request('connection', { provider: p?.id, name: $('connection-name').value,
      baseURL: $('base-url').value, api: $('protocol').value, apiKeyEnv: $('key-ref').value,
      apiKey: key, modelId: p ? '' : $('first-model').value, contextWindow: 131072,
      maxTokens: 8192, revision: p?.revision ?? state.providerRevision })
    viewing = result.provider
    setDirty(Boolean(result.partial))
    await load(viewing)
    if (result.partial) $('api-key').value = key
    notice(result.partial ? result.message : '连接已保存，填写的密钥已一并保存。可在下方添加模型或设为默认。', Boolean(result.partial))
  })
})
$('model-form').addEventListener('submit', (event) => {
  event.preventDefault()
  void perform(async () => {
    const result = await request('model', { provider: viewing, modelId: $('model-id').value,
      contextWindow: Number($('context-window').value), maxTokens: Number($('model-max').value),
      revision: existing().revision, limitsRevision: state.limitsRevision })
    if (result.partial) {
      state = await request('state')
      $('model-error').textContent = result.message
      notice(result.message, true)
      return
    }
    modelDirty = false
    $('model-dialog').close()
    await load(viewing)
    notice('模型已保存，输出上限在新建对话时生效。')
  })
})
$('test-connection').addEventListener('click', () => {
  if (!requireSaved()) return
  void perform(async () => {
    const result = await request('catalog', { provider: viewing })
    $('catalog-options').replaceChildren(...result.models.map((model) => new Option(model.id, model.id)))
    notice(`${result.message} 发现 ${result.models.length} 个模型，点击“添加模型”可选择；未自动修改模型目录。`)
  })
})
$('service-type').addEventListener('change', () => {
  const preset = presets[$('service-type').value]
  $('base-url').value = preset.url
  $('protocol').value = preset.api
  $('first-model').value = preset.model
  setDirty(true)
  if ($('service-type').value === 'local') notice('本地服务仍需配置适配器接受的密钥；留空不会自动开启免认证模式。')
})
$('connection-form').addEventListener('input', () => setDirty(true))
$('model-form').addEventListener('input', () => { modelDirty = true })
$('add-config').addEventListener('click', () => choose('__new__'))
$('provider').addEventListener('change', () => choose($('provider').value))
$('add-model').addEventListener('click', () => openModel())
$('cancel-model').addEventListener('click', () => { if (!busy) { modelDirty = false; $('model-dialog').close() } })
$('model-dialog').addEventListener('cancel', (event) => { if (busy) event.preventDefault(); else modelDirty = false })
$('discard').addEventListener('click', () => { if (!busy) { setDirty(false); render(); notice('已放弃未保存修改。') } })
$('reload').addEventListener('click', () => {
  if (dirty || modelDirty) { notice('请先保存或放弃未保存修改。', true); return }
  void perform(async () => { await load(viewing); notice('配置已重新加载。') })
})
window.addEventListener('beforeunload', (event) => { if (dirty || modelDirty) { event.preventDefault(); event.returnValue = '' } })
try { await load(); notice('配置已加载。') } catch (error) { notice(error.message, true) }
