import { element, button, message, table, disclosure } from './mche-elements.js'

export function guidancePane(state, actions, active, component) {
  const section = element('section', '', 'mche-guidance'), g = state.guidance
  const count = g?.groups.reduce((n, group) => n + group.issues.length, 0) ?? 0
  section.append(message(`${[['tube', '扁管'], ['fin', '翅片'], ['refrigerant', '冷媒']].map(([key, label]) => `${label} ${state.selections[key]?.name ?? '未选'}${state.selections[key] && !state.status[key + 'Confirmed'] ? '（待确认）' : ''}`).join(' · ')} · ${state.status.calculationReady ? '可开始计算' : '计算待核对'} · 待处理 ${count}`))
  section.firstChild.classList.add('mche-status')
  if (!g) return section
  const all = element('div')
  const s = g.stages
  all.append(message(`${s.dataRead ? '资料已读' : '资料未读'} · ${s.draftSaved ? '草稿已保存' : '尚无草稿'} · 部件确认 ${s.componentsConfirmed}/3 · ${s.calculationConfirmed ? '计算输入已确认' : '计算输入待确认'} · ${s.mappingReady ? '映射就绪' : '映射未就绪'} · ${s.calculationSucceeded ? '当前快照实际计算成功' : '当前快照尚无成功计算'}`))
  const issueRow = issue => {
    const row = element('div', '', 'mche-guidance-issue'), link = button('前往核对', () => actions.navigate(issue.entry))
    link.dataset.readOnly = 'true'
    row.append(message(issue.reasons.join('；')), link,
      disclosure('来源与影响', message(`${issue.sources.join('；')} · 影响：${issue.impact}`)))
    return row
  }
  const related = g.groups.flatMap(group => group.issues).filter(issue => issue.entry.view === active && (!issue.entry.component || issue.entry.component === component))
  const current = element('div', '', 'mche-current-issues')
  related.slice(0, 3).forEach(issue => current.append(issueRow(issue)))
  if (related.length > 3) {
    const more = element('div'); related.slice(3).forEach(issue => more.append(issueRow(issue)))
    current.append(disclosure(`其余当前页待办（${related.length - 3}）`, more, 'more-current-issues'))
  }
  for (const group of g.groups) {
    const d = element('details'); d.dataset.guidanceGroup = group.id
    d.append(element('summary', `${group.label}（${group.issues.length}）`))
    for (const issue of group.issues) d.append(issueRow(issue))
    all.append(d)
  }
  const recommended = g.boundary.recommended
  if (!g.boundary.selected && recommended) all.append(message(`推荐组合还缺：${recommended.missing.map(k => state.requirements.fields[k]?.label ?? k).join('、') || '无输入缺项'}。${recommended.executionMessage}`))
  for (const capability of g.capabilities) all.append(message(capability.message))
  const raw = element('details'); raw.append(element('summary', '完整来源与原始诊断（含旧逻辑清单）'),
    element('pre', JSON.stringify(g.details, null, 2), 'detail-text')); all.append(raw)
  section.append(disclosure('查看全部状态', all, 'all-status'), current)
  if (['conditions', 'engineering', 'preparation', 'results'].includes(active)) section.append(message('计算能力有限，工程精度尚未验证。完整限制见全部状态。'))
  return section
}

export function recommendationBasisPane(result, fields = {}) {
  const section = element('section', '', 'mche-recommendation-basis'), basis = result.basisSummary
  if (result.staleReason) section.append(message(result.staleReason))
  if (!basis) { section.append(message('旧记录缺少依据摘要，请重新比较。')); return section }
  const content = element('div')
  content.append(message(basis.summary),
    table(['实际采用约束', '值 / 单位', '状态', '来源'], basis.constraints.map(c => [fields[c.field]?.label ?? c.field,
      `${typeof c.value === 'object' ? JSON.stringify(c.value) : c.value} ${c.unit}`, `${c.basis === 'confirmed' ? '已确认' : '草稿'}${c.filtering ? '' : ' · 仅参考'}`, c.source])))
  const details = element('details'); details.append(element('summary', '生成时的参考资料与已选部件'),
    element('pre', JSON.stringify({ references: basis.references, selected: basis.selected, source: basis.source, digest: basis.contextDigest }, null, 2), 'detail-text'))
  content.append(details); section.append(disclosure('服务端比较依据', content, 'recommendation-basis')); return section
}
