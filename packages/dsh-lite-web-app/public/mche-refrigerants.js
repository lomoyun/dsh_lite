import { element, button, message, table, issues, disclosure, primaryAction } from './mche-elements.js'
import { recommendationBasisPane } from './mche-guidance.js'
const bases = { volume: '体积浓度（Vol.）', mass: '质量浓度（Wt.）' }
const concentration = r => r.concentrationPercent === null ? '原表未提供浓度' : `${r.concentrationPercent}% · ${bases[r.concentrationBasis] ?? '基准待核对'}`
export function refrigerantGeometry(record) {
  const { refrigerant: r, source } = record, section = element('section')
  section.append(element('h3', `冷媒 ${r.name}`), message(`序号 ${r.sequence} · ${r.category} · ${concentration(r)}`),
    message(`来源：${source.path} · ${source.sheet}!${r.sourceRange}`),
    table(['字段', '原表值', '单元格'], Object.entries(record.fields).map(([key, field]) => [field.label,
      r.evidence[key].display || '未提供', r.evidence[key].cell])),
    message(`浓度基准：${bases[r.concentrationBasis] ?? '原表未提供'}${r.concentrationBasisSource ? ` · 依据 ${r.concentrationBasisSource} 的介质标识` : ''}。浓度列E在原表中隐藏，已保留原数据。`),
    issues('待核对项', r.review))
  return section
}
export function refrigerantPane(record, actions) {
  const section = refrigerantGeometry(record)
  section.append(button(`建议选择冷媒 ${record.refrigerant.name}`, () => actions.mutate('refrigerant-propose', { name: record.refrigerant.name, reason: '用户按原表介质标识选择' }, 'selection')))
  return section
}
function card(record, actions, stale = false, assessed = false) {
  const section = element('article', '', 'mche-candidate')
  section.dataset.recordId = record.name
  if (assessed) section.append(message(`${stale ? '候选已过期，请重新比较' : '当前比较'} · 满足 ${record.satisfied.length} · 不满足 ${record.unmet.length} · 未知 ${record.unknown.length}`))
  section.append(element('h4', record.name), message(`序号 ${record.sequence} · ${record.category} · ${concentration(record)}`), message(record.description))
  if (assessed) section.append(issues('满足', record.satisfied), issues('不满足', record.unmet), issues('未知', record.unknown))
  const propose = button(`建议选择冷媒 ${record.name}`, () => actions.mutate('refrigerant-propose', { name: record.name, reason: '用户从冷媒目录或比较结果中选择' }, 'selection'))
  propose.dataset.unavailable = String(Boolean(stale))
  section.append(propose, button(`查看冷媒 ${record.name} 来源`, () => actions.run(async () => {
    actions.showRefrigerant(await actions.request('refrigerant', { name: record.name })); return null
  })))
  return section
}
export function refrigerantCandidatesPane(state, actions) {
  const section = element('section'), names = element('input'), category = element('select')
  names.setAttribute('aria-label', '冷媒精确标识或比较标识'); names.placeholder = '例如 R134a 或 EG30Vol.,EG30Wt.'
  category.setAttribute('aria-label', '浏览冷媒类别'); category.add(new Option('全部冷媒 / 载冷剂', ''))
  Object.entries(state.fields.refrigerantCategory.options).forEach(([key, label]) => category.add(new Option(label, key)))
  section.append(element('h3', '冷媒候选比较'), names,
    button('查询冷媒标识', () => actions.run(async () => { actions.showRefrigerant(await actions.request('refrigerant', { name: names.value.trim() })); return null })),
    button('比较 / 筛选冷媒', () => actions.mutate('refrigerant-recommend', { ...(names.value.trim() ? { names: names.value.split(/[,，]/).map(n => n.trim()) } : {}), limit: 10 })),
    category, button('浏览冷媒库', () => actions.run(async () => {
      const query = { ...(category.value ? { category: category.value } : {}), limit: 10 }
      actions.showSearch(await actions.request('refrigerant-search', query), query); return null
    })))
  const result = state.refrigerantCandidates
  if (!result) { section.append(message('可以浏览全部介质、查询精确标识，或在输入核对中填写类别及浓度条件后比较。')); return section }
  section.append(recommendationBasisPane(result, state.fields))
  const stale = result.stale || result.catalogDigest !== state.currentRefrigerantCatalogDigest
  section.append(message(`${stale ? '比较依据已变化，请重新比较。' : ''}依据：${({ draft: '草稿（未确认）', confirmed: '已确认条件', no_conditions: '无条件浏览目录' })[result.basis]}。${result.policy}`),
    message(`共 ${result.total} 项，排除 ${result.excluded} 项，本页 ${result.items.length} 项。`))
  result.items.forEach(r => section.append(card(r, actions, stale, true)))
  if (result.nextOffset !== null) section.append(button('下一页冷媒候选', () => actions.mutate('refrigerant-recommend', { offset: result.nextOffset, limit: 10, ...(result.names ? { names: result.names } : {}) })))
  return section
}
export function refrigerantCatalogPane(result, query, actions) {
  const section = element('section')
  section.append(element('h3', '冷媒目录'), message(`共 ${result.total} 项，本页 ${result.items.length} 项。浓度空白保持未知，Vol.和Wt.分别选择。`))
  result.items.forEach(r => section.append(card(r, actions)))
  if (result.nextOffset !== null) section.append(button('下一页冷媒目录', () => actions.run(async () => {
    const next = { ...query, offset: result.nextOffset }; actions.showSearch(await actions.request('refrigerant-search', next), next); return null
  })))
  return section
}
export function refrigerantSelectionPane(state, actions, proposalId) {
  const section = element('section'), selected = state.selections.refrigerant
  const p = proposalId ? state.proposals.find(p => p.id === proposalId && p.component === 'refrigerant') : state.proposals.findLast(p => p.component === 'refrigerant')
  section.append(element('h3', '冷媒确认'))
  if (p) {
    const pending = p.status === 'pending' && p.catalogDigest === state.currentRefrigerantCatalogDigest
    section.append(message(`建议冷媒：${p.name} · ${pending ? '等待确认' : '已处理或失效'}`), message(`建议理由：${p.reason}`),
      element('h4', '服务端核对结果'), issues('满足的条件', p.assessment.satisfied),
      message(`序号 ${p.assessment.sequence} · ${p.assessment.category} · ${concentration(p.assessment)}`),
      issues('不满足的条件', p.assessment.unmet), issues('待核实依据', p.assessment.unknown))
    const confirm = button(`确认选择冷媒 ${p.name}`, () => actions.mutate('confirm-refrigerant', { revision: state.revision, proposalId: p.id }, 'selection'))
    confirm.dataset.unavailable = String(!pending); section.append(primaryAction(confirm))
  } else section.append(message('尚无冷媒建议，可在候选比较中查询或浏览冷媒库。'))
  if (selected) {
    section.append(message(`当前冷媒：${selected.name} · ${selected.confirmed ? '已确认' : '需要重新确认'}${selected.invalidReason ? `。${selected.invalidReason}` : ''}`))
    if (state.refrigerantCatalogChanged) section.append(message('冷媒目录已更新，以下保留确认时的历史快照。'))
    section.append(issues('已选介质待核对项', state.snapshots[selected.snapshotId].refrigerant.review))
    section.append(disclosure('完整介质信息与目录证据', refrigerantGeometry(state.snapshots[selected.snapshotId]), 'refrigerant-snapshot'))
  }
  return section
}
