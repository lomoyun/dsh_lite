const $ = (id) => document.getElementById(id)
const labels = { inherit: '使用宿主默认', persona: '覆盖角色描述', complete: '完整覆盖 system prompt' }
const descriptions = {
  inherit: '不添加覆盖，继续使用宿主配置中的角色与插件提示词。',
  persona: '只替换角色描述，保留 Harness 身份和工具指导。',
  complete: '替换全部 system 文本，但工具、技能目录及运行环境仍然存在。',
}
let saved
let busy = false
let dirty = false
function notice(text, error = false) { $('notice').textContent = text; $('notice').className = error ? 'error' : '' }
function changed(value = true) {
  dirty = value
  $('discard').hidden = !value
  $('count').textContent = `${$('prompt').value.length} / 24000`
  $('prompt').disabled = $('mode').value === 'inherit'
  $('mode-help').textContent = descriptions[$('mode').value]
  if (value) $('preview-state').textContent = '编辑已变化，请重新预览'
}
function showPreview(data, label) {
  $('preview').textContent = data.system || '（空 system prompt）'
  $('preview-state').textContent = label
  $('preview-context').textContent = `预览模型：${data.provider} / ${data.model}`
  $('sections').textContent = `System 段落：${data.sections.join('、') || '无'}`
  $('tools').textContent = `保留工具：${data.tools.join('、') || '无'}`
}
async function request(action, input) {
  const response = await fetch(`/api/prompt-config/${action}`, input ? {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  } : {})
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || '请求失败')
  return data
}
function render() {
  $('mode').value = saved.mode
  $('prompt').value = saved.text
  $('saved-mode').textContent = `当前：${labels[saved.mode]}`
  changed(false)
  showPreview(saved.preview, '已保存配置')
}
async function run(work) {
  if (busy) return
  busy = true
  $('editor').inert = true
  for (const id of ['reload', 'discard', 'confirm-restore', 'cancel-restore']) $(id).disabled = true
  notice('正在处理…')
  try { await work() }
  catch (error) { notice(error instanceof TypeError ? '无法连接本地服务，请检查服务后重试。' : error.message, true) }
  finally {
    busy = false
    $('editor').inert = false
    for (const id of ['reload', 'discard', 'confirm-restore', 'cancel-restore']) $(id).disabled = false
  }
}
const draft = () => ({ mode: $('mode').value, text: $('prompt').value })
async function persist(value) {
  await request('save', { ...value, revision: saved.revision })
  changed(false)
  try { saved = await request('state'); render(); notice('已保存，新建对话后生效。已有对话不变。') }
  catch { notice('设置已保存，但页面刷新失败，请重新加载后继续。', true) }
}
$('editor').addEventListener('input', () => changed())
$('mode').addEventListener('change', () => changed())
$('editor').addEventListener('submit', (event) => { event.preventDefault(); if (saved) void run(() => persist(draft())) })
$('preview-button').addEventListener('click', () => void run(async () => {
  showPreview(await request('preview', draft()), '当前草稿 · 尚未保存')
  notice('预览已更新，没有保存配置或调用模型。')
}))
$('use-default').addEventListener('click', () => {
  if (!saved || busy) return
  if ($('prompt').value && dirty) { notice('请先保存或放弃当前草稿，避免覆盖未保存文本。', true); return }
  $('mode').value = 'persona'; $('prompt').value = saved.preview.defaultPersona; changed()
})
$('restore').addEventListener('click', () => { if (saved && !busy) $('restore-dialog').showModal() })
$('cancel-restore').addEventListener('click', () => $('restore-dialog').close())
$('confirm-restore').addEventListener('click', () => void run(async () => {
  await persist({ mode: 'inherit', text: '' }); $('restore-dialog').close()
}))
$('restore-dialog').addEventListener('cancel', (event) => { if (busy) event.preventDefault() })
$('discard').addEventListener('click', () => { if (saved && !busy) { render(); notice('已放弃未保存修改。') } })
$('reload').addEventListener('click', () => {
  if (dirty) { notice('请先保存草稿或放弃未保存修改，再重新加载。', true); return }
  void run(async () => { saved = await request('state'); render(); notice('已重新加载。') })
})
window.addEventListener('beforeunload', (event) => { if (dirty) { event.preventDefault(); event.returnValue = '' } })
await run(async () => { saved = await request('state'); render(); notice('设置已加载。') })
