import { element, button, message, table, issues, numberText, disclosure, primaryAction } from './mche-elements.js'
import { recommendationBasisPane } from './mche-guidance.js'

function review(fin) {
  const section = element('section')
  for (const [key, label] of Object.entries({ conflicts: '尺寸矛盾', unknownGeometry: '未知 / 非单值几何',
    specifications: '范围与上限规格', restrictions: '原表使用限制', notes: '编号与字段说明' })) section.append(issues(label, fin[key]))
  return section
}
function dimensions(fin) {
  const g = fin.geometry, text = fin.geometryText ?? {}
  const entries = [['thicknessMm', '料厚'], [g.stockWidthMm === undefined ? 'widthMm' : 'stockWidthMm', g.stockWidthMm === undefined ? '翅片宽度' : '料宽'],
    [g.slotPitchMm === undefined ? 'heightPostBrazingMm' : 'slotPitchMm', g.slotPitchMm === undefined ? '焊后高度' : '槽间距'], ['finPitchMm', '片距']]
  return entries.filter(([key]) => Object.hasOwn(g, key)).map(([key, label]) => `${label} ${text[key] || numberText(g[key])} mm`).join(' · ')
}
export function finGeometry(record) {
  const { fin, fields, source, section: definition } = record, section = element('section')
  section.append(element('h3', `翅片 ${fin.name}`), message(`Code/ERP：${fin.code ?? '未提供有效编号'} · ${definition.label}`),
    message(`来源：${source.path} · ${source.sheet}!${fin.sourceRange}`))
  const rows = Object.entries(fin.geometry).map(([key, value]) => [fields[key].label, value === null ? '非单值 / 未知（见原文）' : numberText(value),
    fields[key].unit ?? '个', fin.evidence[key]?.display ?? '', fin.evidence[key]?.cell ?? ''])
  section.append(table(['尺寸', '目录值', '单位', '原文', '单元格'], rows))
  if (Object.values(fields).some(f => f.unitBasis === 'workbook_column_unit_inherited')) section.append(message('本分区单位沿用主表单位行，正式计算前需要确认。'))
  const extra = [...Object.entries(fin.selection), ...Object.entries(fin.unclassified)].filter(([, value]) => value !== null && value !== '')
  section.append(table(['附加资料', '原文', '单元格'], extra.map(([key]) => [fields[key]?.label ?? `未标注列 ${fields[key]?.column ?? key}`,
    fin.evidence[key]?.display ?? '', fin.evidence[key]?.cell ?? ''])), review(record), message(`目录摘要：${record.catalogDigest}。确认型号不表示使用限制已解决或装配匹配已验证。`))
  return section
}
export function finPane(record, actions) {
  const section = finGeometry(record)
  section.append(button(`建议选择翅片 ${record.fin.name}`, () => actions.mutate('fin-propose', { name: record.fin.name, reason: '用户直接查询并选择翅片型号' }, 'selection')))
  return section
}
function card(fin, actions, stale, recommend = true) {
  const article = element('article', '', 'mche-candidate')
  article.dataset.recordId = fin.name
  if (recommend) article.append(message(`${stale ? '候选已过期，请重新比较' : '当前比较'} · 满足 ${fin.satisfied.length} · 不满足 ${fin.unmet.length} · 未知 ${fin.unknown.length}`))
  article.append(element('h4', fin.name), message(`Code/ERP ${fin.code ?? '未提供'} · ${fin.sectionLabel}`), message(dimensions(fin)))
  if (recommend) article.append(issues('满足', fin.satisfied), issues('不满足', fin.unmet), issues('未知', fin.unknown))
  article.append(review(fin))
  const propose = button(`建议选择翅片 ${fin.name}`, () => actions.mutate('fin-propose', { name: fin.name, reason: '用户在候选比较中选择翅片型号' }, 'selection'))
  propose.dataset.unavailable = String(Boolean(stale))
  article.append(propose, button(`查看翅片 ${fin.name} 来源`, () => actions.run(async () => {
    actions.showFin(await actions.request('fin', { name: fin.name })); return null
  })))
  return article
}
export function finCandidatesPane(state, actions) {
  const section = element('section'), names = element('input'), code = element('input')
  names.setAttribute('aria-label', '翅片精确型号或比较型号'); names.placeholder = '例如 B01,B02；留空按翅片条件推荐'
  code.setAttribute('aria-label', '翅片Code或ERP'); code.placeholder = '例如 310150，返回全部对应型号'
  section.append(element('h3', '翅片候选比较'), names,
    button('查询翅片型号', () => actions.run(async () => { actions.showFin(await actions.request('fin', { name: names.value.trim() })); return null })),
    button('比较 / 推荐翅片', () => actions.mutate('fin-recommend', { ...(names.value.trim() ? { names: names.value.split(/[,，]/).map(s => s.trim()) } : {}), limit: 10 })), code,
    button('按Code查询翅片', () => actions.run(async () => { const query = { code: code.value.trim(), limit: 10 }; actions.showSearch(await actions.request('fin-search', query), query); return null })))
  const result = state.finCandidates
  if (!result) { section.append(message('可直接查询翅片型号，或在翅片输入核对中填写分区及尺寸后比较。')); return section }
  section.append(recommendationBasisPane(result, state.fields))
  const stale = result.stale || result.catalogDigest !== state.currentFinCatalogDigest
  section.append(message(`${stale ? '此推荐已失效，请重新比较。' : ''}依据：${({ draft: '草稿（未确认）', confirmed: '已确认条件', no_conditions: '无条件浏览目录' })[result.basis]}。${result.policy}`),
    message(`符合条件 / 指定比较 ${result.total} 项，排除 ${result.excluded} 项，本页 ${result.items.length} 项。`))
  for (const fin of result.items) section.append(card(fin, actions, stale))
  if (result.nextOffset !== null) section.append(button('下一页翅片候选', () => actions.mutate('fin-recommend', { offset: result.nextOffset, limit: 10, ...(result.names ? { names: result.names } : {}) })))
  return section
}
export function finCatalogPane(result, query, actions) {
  const section = element('section')
  section.append(element('h3', '翅片目录筛选'), message(`共 ${result.total} 项，本页 ${result.items.length} 项。查询条件：${JSON.stringify(query)}`))
  for (const fin of result.items) section.append(card(fin, actions, false, false))
  if (result.nextOffset !== null) section.append(button('下一页翅片目录', () => actions.run(async () => {
    const next = { ...query, offset: result.nextOffset }; actions.showSearch(await actions.request('fin-search', next), next); return null
  })))
  return section
}
export function finSelectionPane(state, actions, proposalId) {
  const section = element('section'), selected = state.selections.fin
  const proposal = proposalId ? state.proposals.find(p => p.id === proposalId && p.component === 'fin') : state.proposals.findLast(p => p.component === 'fin')
  section.append(element('h3', '翅片型号确认'))
  if (proposal) {
    const pending = proposal.status === 'pending' && proposal.catalogDigest === state.currentFinCatalogDigest
    section.append(message(`建议翅片：${proposal.name} · ${pending ? '等待确认' : '已处理或失效'}`), message(`建议理由：${proposal.reason}`),
      element('h4', '服务端核对结果'), issues('满足的条件', proposal.assessment.satisfied),
      issues('不满足的条件', proposal.assessment.unmet), issues('待核实依据', proposal.assessment.unknown), review(proposal.assessment))
    const confirm = button(`确认选择翅片 ${proposal.name}`, () => actions.mutate('confirm-fin', { revision: state.revision, proposalId: proposal.id }, 'selection'))
    confirm.dataset.unavailable = String(!pending)
    section.append(primaryAction(confirm), message('确认后保存该型号的目录快照，与已选扁管同时保留。尺寸待核对项、装配匹配和计算状态仍单独处理。'))
  } else section.append(message('尚无翅片建议，可在候选比较中查询或建议型号。'))
  if (selected) {
    section.append(message(`当前翅片：${selected.name} · ${selected.confirmed ? '已确认' : '需要重新确认'}${selected.invalidReason ? `。${selected.invalidReason}` : ''}`))
    if (state.finCatalogChanged) section.append(message('翅片目录已更新，以下仍为确认时的几何快照，没有自动替换。'))
    section.append(review(state.snapshots[selected.snapshotId]))
    section.append(disclosure('完整几何与目录证据', finGeometry(state.snapshots[selected.snapshotId]), 'fin-snapshot'))
  }
  return section
}
