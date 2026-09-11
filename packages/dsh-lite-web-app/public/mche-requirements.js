import { element, button, message, table, issues, disclosure, primaryAction } from './mche-elements.js'

const roles = { calculation_input: '计算输入', design_target: '设计目标', reference: '参考信息', test_reference: '测试参考' }
const valueText = entry => entry ? `${entry.value} ${entry.unit ?? ''}` : '未填写 / 清除'
const modeText = (boundary, modes) => boundary ? ['refrigerant', 'air', 'flow'].map(key => modes[key][boundary[key]]?.label ?? '未选择').join(' · ') : '尚未选择'
function unavailable(node, condition) { node.dataset.unavailable = String(condition); node.disabled = condition; return node }
const details = (title, content, open = false) => disclosure(title, content, undefined, open)
function editControl(field, entry, label, actions) {
  const box = element('div', '', 'mche-requirement-editor'), value = element(field.text ? 'textarea' : 'input'), unit = element('select'), source = element('textarea')
  value.value = entry?.value ?? ''; value.maxLength = 4000; value.setAttribute('aria-label', `${label}采用值`)
  if (!field.text) value.inputMode = 'decimal'
  const units = [...new Set([...(field.units ? Object.keys(field.units) : ['']), ...(entry?.unit ? [entry.unit] : [])])]
  if (!field.text) unit.add(new Option('单位待明确', ''))
  units.forEach(u => unit.add(new Option(u || '原文', u)))
  unit.value = entry?.unit ?? field.unit ?? ''; unit.setAttribute('aria-label', `${label}单位`)
  source.value = entry?.source ?? ''; source.maxLength = 1200; source.setAttribute('aria-label', `${label}依据`)
  for (const node of [value, unit, source]) for (const event of ['input', 'change']) node.addEventListener(event, () => actions.dirty(true))
  const evidence = element('div'); evidence.append(source)
  box.append(value, unit, details('依据', evidence))
  return { box, entry, value, unit, source, label, evidence }
}

export function profileOverview(profile) {
  const panel = element('section', '', 'mche-profile')
  panel.append(element('h4', '已映射工况'), message('所有已读工况均保留；用途随输入组合切换。修改主编辑区采用值并保存后，过热度由后端重新计算。'))
  for (const area of profile.sections) {
    const content = element('div'), inactive = element('div')
    for (const field of area.fields) {
      const card = element('article', '', 'mche-requirement'), entry = field.entry
      card.dataset.profileField = field.key
      card.append(element('h5', `${field.target} · ${field.label} · ${roles[field.role]}`),
        message(`采用值：${entry?.value !== null && entry?.value !== undefined ? `${entry.value} ${entry.unit}` : '未填写 / 无法派生'}`),
        message(`来源：${entry?.source || '尚无依据'}`))
      if (field.issues.length) card.append(message(`待核：${field.issues.join('；')}`))
      if (field.signConvention) card.append(message('SC 保存非负过冷度；出口目标按所选组合生效。'))
      card.append(details('单位转换与派生依据', element('pre', JSON.stringify({
        normalized: entry?.normalized, normalizedUnit: entry?.normalizedUnit, conversion: entry?.conversion,
        unitBasis: field.unitBasis, derivation: field.derivation, signConvention: field.signConvention,
      }, null, 2), 'detail-text')))
      if (!entry && field.role !== 'calculation_input') inactive.append(card)
      else content.append(card)
    }
    if (inactive.childElementCount) content.append(details('其他模式的未填字段（非当前必填）', inactive))
    panel.append(details(area.label, content, true))
  }
  return panel
}

export function requirementsPane(state, actions) {
  const section = element('section'), req = state.requirements, doc = req.document, assessment = req.assessment, controls = new Map(), supplements = new Map(), selectors = {}
  section.append(element('h3', '客户需求'))
  const filePanel = element('div'), fileSelect = element('select'), sheet = element('input')
  fileSelect.setAttribute('aria-label', '需求来源 Excel'); sheet.setAttribute('aria-label', '需求表 Sheet（多表时填写）'); sheet.placeholder = '多张需求表时填写精确 Sheet 名'
  const fileList = button('选择当前会话 Excel', () => actions.run(async () => {
    const data = await actions.request('requirements-files')
    fileSelect.replaceChildren(...data.files.filter(f => f.status === 'ready').map(f => new Option(f.name, f.fileId)))
    filePanel.replaceChildren(data.files.some(f => f.status === 'ready') ? fileSelect : message('当前会话没有已解析 Excel，请通过聊天附件上传。'), sheet,
      unavailable(button('读取冷凝器需求', () => readTable({ ...(sheet.value.trim() ? { sheet: sheet.value.trim() } : {}) })), !data.files.some(f => f.status === 'ready')))
    return null
  }))
  const files = element('div'); files.append(fileList, filePanel)
  section.append(doc ? disclosure('需求来源与重新读取', files, 'requirements-files') : files)
  async function readTable(selection) {
    return actions.run(async () => {
      if (section.closest('.mche-view')?.dataset.dirty === 'true') throw new Error('请先保存输入草稿，再读取需求表。')
      const result = await actions.request('requirements-read', { fileId: fileSelect.value, revision: state.revision, ...selection })
      if (!result.selectionRequired) return result
      const candidates = element('div'); candidates.append(message(result.message))
      for (const c of result.candidates) candidates.append(button(`${c.sheet}!${c.table}${c.hidden ? '（隐藏）' : ''}`, () => readTable({ sheet: c.sheet, table: c.table })))
      filePanel.append(candidates); return null
    })
  }
  if (!doc) { section.append(message('按表内标题与字段结构识别，不要求固定文件名或位置。')); return section }
  files.prepend(message(`${doc.source.name} · ${doc.sheet} · ${doc.records.length} 条有值记录`),
    details('查看来源及识别依据', element('pre', JSON.stringify({ source: doc.source, title: doc.title, recognition: doc.recognition, issues: doc.issues }, null, 2), 'detail-text')))

  section.append(message(`需求草稿 · ${modeText(req.boundary, req.modes)}`))
  const modes = element('div'); modes.append(message(req.recommendation.basis))
  for (const [key, label] of [['refrigerant', '冷媒模式'], ['air', '空气状态模式'], ['flow', '空气流量模式']]) {
    const row = element('label', label, 'mche-boundary-choice'), select = element('select')
    select.setAttribute('aria-label', label); select.add(new Option('请选择', ''))
    for (const [id, spec] of Object.entries(req.modes[key])) select.add(new Option(spec.label, id))
    select.value = req.boundary?.[key] ?? ''; selectors[key] = select; row.append(select); modes.append(row)
    select.addEventListener('change', () => {
      actions.dirty(true)
      if (Object.values(selectors).length === 3 && Object.values(selectors).every(s => s.value)) void save()
    })
  }
  const recommend = button('采用推荐作为草稿', () => {
    for (const [key, select] of Object.entries(selectors)) select.value = req.recommendation.proposed[key]
    actions.dirty(true); void save()
  })
  modes.append(details('推荐依据与全部备选', table(['模式', '现有字段依据', '计算缺项'], ['refrigerant', 'air', 'flow'].flatMap(key => req.recommendation[key].map(m => [
    m.label, m.reasons.map(r => `${req.fields[r.field].label} ${r.value} ${r.unit}（${r.source}）`).join('\n') || '未提供',
    m.missing.map(k => req.fields[k].label).join('、') || '输入齐备',
  ])))))
  if (!req.boundary) section.append(recommend)
  else modes.prepend(recommend)
  section.append(disclosure('选择 / 更改输入组合', modes, 'boundary-modes'),
    message(`需求核对：${req.reviewed ? '已确认' : '待用户核对'}。当前模式输入：${assessment.inputComplete ? '齐备' : '有缺项'}。`),
    message(req.reviewed ? '已应用快照与当前需求一致。' : '本页为需求草稿；保存后仍需核对并确认，才会应用到计算。'),
    message(!req.boundary ? '选择输入组合后显示当前必填缺项。' : assessment.executionSupported ? '当前模式已接入输入映射；仍需部件和工程核对。' : '当前模式执行尚未接入；可保存和确认需求。'))
  files.append(details('计算能力说明', message(assessment.executionMessage)))
  if (assessment.notes.length) section.append(details('输入说明', message(assessment.notes.join('；'))))
  if (req.mappingStale) section.append(message('映射规则已更新，请重新读取原表后核对。'))
  if (req.sourceCheck?.valid === false) section.append(message(`来源待核：${req.sourceCheck.message}`))
  section.append(issues('确认前需处理', assessment.confirmationBlockers))
  if (assessment.missing.length) section.append(message(`当前必填缺项：${assessment.missing.map(item => req.fields[item.field]?.label ?? item.message).join('、')}`))
  if (req.refrigerantSuggestion) {
    const suggestion = req.refrigerantSuggestion
    section.append(message(`需求冷媒 ${suggestion.requested} · 已选 ${suggestion.selected ?? '未选择'}${suggestion.different ? ' · 两者不同，请核对' : ''}`))
    files.append(message(suggestion.message))
    if (suggestion.exactMatch) section.append(button(`查看并建议冷媒 ${suggestion.requested}`, () => actions.run(async () => {
      actions.showRefrigerant(await actions.request('refrigerant', { name: suggestion.requested })); return null
    })))
  }

  for (const [group, title] of [['main', '主工况已填内容'], ['requirements', '客户设计、安装与可靠性要求'], ['test', '测试条件（独立保留）']]) {
    const content = element('div'), inactive = element('div'), rows = assessment.rows.filter(r => r.group === group)
    for (const record of rows) {
      const field = req.fields[record.key], card = element('article', '', 'mche-requirement'), label = field.label
      card.dataset.recordId = record.id; card.dataset.field = record.key
      card.append(element('h5', label))
      const control = editControl(field, record.current, label, actions); controls.set(record.id, control); card.append(control.box)
      if (record.currentIssues.length) card.append(message(`待核：${record.currentIssues.join('；')}`))
      control.evidence.prepend(message(`${roles[record.role]} · ${record.originalName}`), message(`原文：${record.display}（${record.source.sheet}!${record.source.address}）`))
      control.evidence.append(element('pre', JSON.stringify({ raw: record.raw, display: record.display, cell: record.cell, unitCandidates: record.unitCandidates, unitBasis: record.unitBasis, source: record.source, originalIssues: record.issues, adopted: record.current, derived: assessment.entries[record.key]?.derivation }, null, 2), 'detail-text'))
      ;(group === 'main' && req.boundary && record.role !== 'calculation_input' ? inactive : content).append(card)
    }
    const count = rows.filter(r => r.currentIssues.length).length
    if (rows.length) {
      if (group === 'main') {
        section.append(element('h4', '主工况采用值'), content)
        if (inactive.childElementCount) section.append(disclosure(`其他模式与设计目标（${inactive.childElementCount} 条 · ${rows.filter(r => r.role !== 'calculation_input' && r.currentIssues.length).length} 项异常）`, inactive, 'other-main-fields'))
      } else section.append(disclosure(`${title}（${rows.length} 条 · ${count} 项异常）`, content, 'records-' + group))
    }
  }
  const extra = element('div'), other = element('div')
  for (const [key, field] of Object.entries(req.fields).filter(([key, field]) => field.boundary && !doc.records.some(r => r.key === key))) {
    const current = req.supplements[key], row = element('article', '', 'mche-requirement'), active = assessment.keys.includes(key)
    row.dataset.field = key; row.append(element('h5', field.label))
    const control = editControl(field, current, field.label, actions); supplements.set(key, control); row.append(control.box)
    if (key === 'refSuperheat') {
      row.append(message(`派生 SH：${assessment.derived[0]?.calculated ?? '无法计算'} K`))
      control.evidence.append(message('仅填写独立明确的 SH，用于与派生结果核对；清空后使用派生值。'), element('pre', JSON.stringify(assessment.derived, null, 2), 'detail-text'))
    }
    if (current && assessment.entries[key]?.normalized === null) row.append(message('数值或单位尚未明确，不能作为计算输入。'))
    if (active && !assessment.entries[key]?.normalized && assessment.entries[key]?.normalized !== 0) row.append(message('当前必填 · 待补充数值、单位及依据'))
    ;(active ? extra : other).append(row)
  }
  section.append(element('h4', '当前模式补填'), extra, disclosure(`其他模式的补填字段（${other.childElementCount}）`, other, 'other-supplements'),
    disclosure('已映射工况核对表', profileOverview(req.profileDraft), 'profile-overview'),
    details('填写说明', message('压力为绝压；含湿量为 kg/kg 或 g/kg；过热/过冷度为温差。管数、带翅片/无翅片长度及方向在“工况与结构”补填。')),
    primaryAction(button('保存需求草稿', () => save())))

  const comparison = element('div')
  comparison.append(
    message(`当前计算：${modeText(req.boundaryDifference.before, req.modes)}。本次采用：${modeText(req.boundary, req.modes)}。`),
    table(['参数', '当前计算草稿', '确认后采用', '依据'], req.difference.map(d => [req.fields[d.field]?.label ?? d.field, valueText(d.before), valueText(d.after), d.after?.source ?? '从本次输入移除；需求原文仍保留'])),
    message('确认会保存全部需求及来源快照，并原子更新当前计算草稿。旧计算确认和准备包随即失效；缺项仍可继续补填，未接入模式仍阻塞执行。'),
    unavailable(button('确认需求并应用当前工况草稿', () => actions.mutate('requirements-confirm', { revision: state.revision, reviewId: req.reviewId })), !req.boundary || req.reviewed || req.mappingStale || assessment.confirmationBlockers.length > 0))
  const review = disclosure('确认前与当前计算草稿核对差异', comparison, 'requirements-confirmation'); review.hidden = true
  const reviewButton = primaryAction(button('核对并确认', () => {
    if (section.closest('.mche-view')?.dataset.dirty === 'true') return actions.run(() => { throw new Error('请先保存需求草稿，再核对确认。') })
    review.hidden = false; review.open = true; review.scrollIntoView({ block: 'start' }); review.querySelector('summary').focus()
  }))
  reviewButton.dataset.readOnly = 'true'
  section.append(reviewButton, review)

  async function save() {
    return actions.run(async () => {
      const edits = {}, supplementChanges = {}
      for (const [group, target] of [[controls, edits], [supplements, supplementChanges]]) for (const [key, c] of group) {
        const value = c.value.value.trim(), unit = c.unit.value, source = c.source.value.trim()
        if (String(c.entry?.value ?? '') === value && (c.entry?.unit ?? req.fields[key]?.unit ?? '') === unit && (c.entry?.source ?? '') === source) continue
        if (!value && !c.entry) continue
        if (value && !source) throw new Error(`请填写${c.label}的依据`)
        target[key] = value ? { value, unit, source } : null
      }
      const boundary = Object.fromEntries(Object.entries(selectors).map(([key, select]) => [key, select.value]))
      const modeChanged = Object.values(boundary).every(Boolean) && JSON.stringify(boundary) !== JSON.stringify(req.boundary)
      if (!Object.keys(edits).length && !Object.keys(supplementChanges).length && !modeChanged) { actions.dirty(false); return state }
      const result = await actions.request('requirements-draft', { revision: state.revision, edits, supplements: supplementChanges, ...(modeChanged ? { boundary } : {}) })
      if (result.requirements.assessment.confirmationBlockers.length) actions.focusField(result.requirements.assessment.confirmationBlockers[0].field)
      actions.dirty(false); return result
    })
  }
  return section
}
