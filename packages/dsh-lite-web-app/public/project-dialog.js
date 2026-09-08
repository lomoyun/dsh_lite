const $ = (s) => document.querySelector(s)
export async function editRecord({ kind, record, state, save }) {
  const dialog = $('#record-dialog')
  const project = kind === 'project'
  $('#record-heading').textContent = project ? (record ? '项目设置' : '新建项目') : '会话设置'
  $('#record-name').value = record?.name ?? record?.title ?? ''
  $('#project-fields').hidden = !project
  $('#session-fields').hidden = project
  $('#record-archived').checked = record?.archived ?? false
  $('#record-archive-row').hidden = !record
  $('#record-error').textContent = ''
  $('#record-instructions').value = record?.instructions ?? ''
  $('#record-mode').value = record?.prompt?.mode ?? 'inherit'
  $('#record-prompt').value = record?.prompt?.text ?? ''
  $('#record-project').replaceChildren(new Option('未归类', ''), ...state.projects.filter((p) => !p.archived).map((p) => new Option(p.name, p.id)))
  if (record?.projectId && !state.projects.find((p) => p.id === record.projectId && !p.archived)) {
    $('#record-project').add(new Option('原项目（已归档）', record.projectId))
  }
  $('#record-project').value = record?.projectId ?? ''
  $('#record-model').replaceChildren(new Option('跟随全局默认模型', ''))
  if (record?.model) $('#record-model').add(new Option(record.model.model, JSON.stringify(record.model)))
  dialog.showModal()
  $('#record-name').focus()
  $('#record-cancel').onclick = () => dialog.close()
  $('#record-form').onsubmit = async (event) => {
    event.preventDefault()
    $('#record-save').disabled = true
    $('#record-cancel').disabled = true
    try {
      const input = { id: record?.id, revision: state.revision, archived: $('#record-archived').checked }
      if (project) Object.assign(input, { name: $('#record-name').value, instructions: $('#record-instructions').value,
        model: $('#record-model').value ? JSON.parse($('#record-model').value) : null,
        promptMode: $('#record-mode').value, promptText: $('#record-prompt').value })
      else Object.assign(input, { title: $('#record-name').value, projectId: $('#record-project').value || null })
      await save(input)
      dialog.close()
    } catch (error) { $('#record-error').textContent = error.message }
    finally { $('#record-save').disabled = false; $('#record-cancel').disabled = false }
  }
  dialog.oncancel = (event) => { if ($('#record-save').disabled) event.preventDefault() }
  if (project) await loadModels(record)
}
async function loadModels(record) {
  try {
    const response = await fetch('/api/model-config/state')
    if (!response.ok) return
    const state = await response.json()
    const select = $('#record-model')
    for (const provider of state.providers) for (const model of provider.configuredModels) {
      const value = JSON.stringify({ provider: provider.id, model: model.id })
      if (![...select.options].some((o) => o.value === value)) select.add(new Option(`${provider.name} · ${model.id}`, value))
    }
    select.value = record?.model ? JSON.stringify(record.model) : ''
  } catch { /* 可以在模型配置插件未加载时管理项目。 */ }
}
