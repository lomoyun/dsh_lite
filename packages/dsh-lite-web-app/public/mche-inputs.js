import { element, button, message, disclosure, primaryAction } from './mche-elements.js'

function display(value) {
  if (value === undefined) return ''
  return typeof value === 'object' ? `${value.min ?? ''}..${value.max ?? ''}` : String(value)
}
function parsed(text, field) {
  if (field.text) return text
  if (field.range && text.includes('..')) {
    const parts = text.split('..')
    if (parts.length !== 2) throw new Error(`${field.label}范围格式为 15..16`)
    return { ...(parts[0] ? { min: Number(parts[0]) } : {}), ...(parts[1] ? { max: Number(parts[1]) } : {}) }
  }
  return Number(text)
}
export function inputPane(state, actions, component = 'tube') {
  const section = element('section'), controls = new Map()
  section.append(element('h3', '选型条件'), message('核对单位与来源后确认。数值范围支持 15..16、..16、15..。'))
  const fieldsShown = Object.entries(state.fields).filter(([key, field]) => (field.component ?? 'tube') === component || ['application', 'operatingConditions'].includes(key))
  const rows = fieldsShown.map(([key, field]) => {
    const entry = state.draft[key], value = element(field.options ? 'select' : 'input'), unit = element('select')
    if (field.options) {
      value.add(new Option('未指定（不自动推断）', ''))
      Object.entries(field.options).forEach(([key, label]) => value.add(new Option(label, key)))
    }
    value.value = display(entry?.value); value.setAttribute('aria-label', field.label); value.maxLength = field.text ? 4000 : 80
    if (!field.text) value.inputMode = 'decimal'
    const units = field.text ? [''] : Object.keys(field.units)
    units.forEach((name) => unit.add(new Option(name || '原文', name)))
    unit.value = entry?.unit ?? field.unit; unit.setAttribute('aria-label', `${field.label}单位`)
    controls.set(key, { value, unit, field })
    value.addEventListener('input', () => actions.dirty(true)); value.addEventListener('change', () => actions.dirty(true)); unit.addEventListener('change', () => actions.dirty(true))
    const row = element('div', '', 'mche-field'); row.dataset.field = key
    row.append(element('label', field.label + (field.required ? ' *' : '')), value, unit,
      disclosure(state.confirmed[key] ? '已确认 · 依据' : entry ? '草稿 · 依据' : field.required ? '缺项 · 依据' : '未提供 · 依据',
        message(entry ? `${entry.source}${entry.origin === 'agent' ? state.confirmed[key] ? '（Agent 提取，用户已核对）' : '（Agent 提取，来源待核对）' : ''}` : '尚未提供')))
    return row
  })
  section.append(...rows)
  const save = button('保存草稿', () => actions.run(async () => {
    const changes = {}
    for (const [key, { value, unit, field }] of controls) {
      const old = state.draft[key], raw = value.value.trim()
      if (display(old?.value) === raw && (old?.unit ?? field.unit) === unit.value) continue
      changes[key] = raw ? { value: parsed(raw, field), unit: unit.value, source: '用户在输入核对表中填写' } : null
    }
    if (!Object.keys(changes).length) { actions.dirty(false); return state }
    const result = await actions.request('draft', { revision: state.revision, changes })
    actions.dirty(false); return result
  }))
  const fields = fieldsShown.map(([key]) => key).filter(key => state.draft[key] && !state.confirmed[key])
  const confirm = button('确认当前输入', () => actions.mutate('confirm-inputs', {
    revision: state.revision, reviewId: state.inputReviewId, fields,
  }))
  confirm.disabled = !fields.length; confirm.dataset.unavailable = String(!fields.length)
  primaryAction(save); primaryAction(confirm)
  if (!fields.length) section.append(message('当前没有待确认的已保存输入。'))
  section.append(save, confirm, message(component === 'refrigerant' ? '浓度用百分数（例如30表示30%），质量与体积基准分别指定；无浓度值的介质不补成0%或100%。标识及目录数据在冷媒确认时保存。' : component === 'fin' ? '此处保存翅片选型约束；目录几何由型号读取，不能在此覆盖。料宽/翅片宽度和不同分区的槽尺寸分别填写，未填条件不会补造。' : '* 仅表示扁管逻辑参数所需项，不是整机正式参数表。管间距含义待核实，保存不会推断为净间隙或中心距。'))
  return section
}
