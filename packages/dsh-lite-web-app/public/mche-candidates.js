import { element, button, message, table, issues, geometry, numberText, disclosure, primaryAction } from './mche-elements.js'
import { refrigerantGeometry } from './mche-refrigerants.js'
import { recommendationBasisPane } from './mche-guidance.js'

export function candidatePane(state, actions) {
  const section = element('section'), query = element('input')
  query.setAttribute('aria-label', '精确型号或比较型号'); query.placeholder = '例如 A01S,A10；留空按当前条件推荐'
  section.append(element('h3', '候选比较'), query,
    button('查询精确型号', () => actions.run(async () => {
      const record = await actions.request('tube', { name: query.value.trim() })
      actions.showTube(record); return null
    })), button('比较 / 推荐', () => actions.mutate('recommend', {
      ...(query.value.trim() ? { names: query.value.split(/[,，]/).map((name) => name.trim()) } : {}), limit: 10,
    })))
  const result = state.candidates
  if (!result) { section.append(message('可先比较型号，再补充工况。也可让 Agent 根据草稿推荐。')); return section }
  section.append(recommendationBasisPane(result, state.fields))
  section.append(message(`${result.stale ? '此推荐依据已变化，请重新比较。' : ''}生成时依据：${({ draft: '草稿（当时尚未确认）', confirmed: '已确认条件', no_conditions: '尚无尺寸条件，仅浏览目录' })[result.basis]}。${result.policy}`),
    message(`符合条件 / 指定比较 ${result.total} 项，排除 ${result.excluded} 项；本页 ${result.items.length} 项。`))
  for (const tube of result.items) section.append(candidate(tube, actions, result.stale))
  if (result.nextOffset !== null) section.append(button('下一页候选', () => actions.mutate('recommend', { offset: result.nextOffset, limit: 10, ...(result.names ? { names: result.names } : {}) })))
  return section
}
function candidate(tube, actions, stale) {
  const card = element('article', '', 'mche-candidate')
  card.dataset.recordId = tube.name
  card.append(message(`${stale ? '候选已过期，请重新比较' : '当前比较'} · 满足 ${tube.satisfied.length} · 不满足 ${tube.unmet.length} · 未知 ${tube.unknown.length}`))
  card.append(element('h4', tube.name), message(`管宽 ${tube.geometry.widthMm ?? '未知'} mm · 管高 ${tube.geometry.heightMm ?? '未知'} mm · 孔数 ${tube.geometry.portCount ?? '未知'}`),
    issues('满足', tube.satisfied), issues('不满足', tube.unmet), issues('未知', tube.unknown),
    issues('尺寸矛盾', tube.conflicts), issues('未知几何', tube.unknownGeometry))
  const propose = button(`建议选择 ${tube.name}`, () => actions.mutate('propose', { name: tube.name, reason: '用户在候选比较中选择此型号' }, 'selection'))
  propose.disabled = Boolean(stale); propose.dataset.unavailable = String(Boolean(stale))
  card.append(propose, button(`查看 ${tube.name} 来源`, () => actions.run(async () => {
    actions.showTube(await actions.request('tube', { name: tube.name })); return null
  })))
  return card
}
export function tubePane(record, actions) {
  const section = geometry(record)
  section.append(button(`建议选择 ${record.tube.name}`, () => actions.mutate('propose', {
    name: record.tube.name, reason: '用户直接查询并选择型号',
  }, 'selection')))
  return section
}
export function catalogPane(result, query, actions) {
  const section = element('section')
  section.append(element('h3', '目录筛选结果'), message(`共 ${result.total} 个匹配型号，本页 ${result.items.length} 个。查询条件：${JSON.stringify(query)}。尺寸单位 mm。`))
  for (const tube of result.items) {
    const card = element('article', '', 'mche-candidate')
    card.append(element('h4', tube.name), message(`管宽 ${tube.geometry.widthMm ?? '未知'} mm · 管高 ${tube.geometry.heightMm ?? '未知'} mm · 孔数 ${tube.geometry.portCount ?? '未知'}`),
      issues('目录待核对项', tube.review), button(`查看 ${tube.name} 来源`, () => actions.run(async () => {
        actions.showTube(await actions.request('tube', { name: tube.name })); return null
      })))
    section.append(card)
  }
  if (result.nextOffset !== null) section.append(button('下一页目录', () => actions.run(async () => {
    const next = { ...query, offset: result.nextOffset }
    actions.showSearch(await actions.request('search', next), next); return null
  })))
  return section
}
export function selectionPane(state, actions, proposalId) {
  const section = element('section'), selected = state.selections.tube
  section.append(element('h3', '型号确认'))
  const proposal = proposalId ? state.proposals.find((item) => item.id === proposalId && (item.component ?? 'tube') === 'tube') : state.proposals.findLast(item => (item.component ?? 'tube') === 'tube')
  if (proposal) {
    const pending = proposal.status === 'pending' && proposal.catalogDigest === state.currentCatalogDigest
    section.append(message(`建议型号：${proposal.name} · ${pending ? '等待确认' : '已处理或失效'}`), message(`建议理由：${proposal.reason}`),
      element('h4', '服务端核对结果'), issues('满足的条件', proposal.assessment.satisfied),
      issues('不满足的条件', proposal.assessment.unmet), issues('待核实依据', proposal.assessment.unknown))
    const confirm = button(`确认选择 ${proposal.name}`, () => actions.mutate('confirm-tube', { revision: state.revision, proposalId: proposal.id }, 'selection'))
    confirm.disabled = !pending; confirm.dataset.unavailable = String(!pending)
    section.append(primaryAction(confirm), message('确认仅保存该型号的目录快照，仍需处理尺寸矛盾、未知项和参数缺项。'))
  } else section.append(message('尚无型号建议。可在候选比较中查询任意精确型号。'))
  if (selected) {
    section.append(message(`当前型号：${selected.name} · ${selected.confirmed ? '已确认' : '需要重新确认'}${selected.invalidReason ? `。${selected.invalidReason}` : ''}`))
    if (state.catalogChanged) section.append(message('目录已更新；以下保留确认时的历史几何快照，没有自动替换。'))
    section.append(issues('已选型号待核对项', state.snapshots[selected.snapshotId].tube.review))
    section.append(disclosure('完整几何与目录证据', geometry(state.snapshots[selected.snapshotId]), 'tube-snapshot'))
  }
  return section
}
export function preparationPane(state, actions) {
  const section = element('section')
  section.append(element('h3', '参数准备'), message('准备已确认的扁管、翅片与冷媒数据及来源；装配匹配、物性和正式 DLL 映射尚未核实。'),
    button('准备参数', () => actions.mutate('prepare', {}, 'preparation')))
  const prep = state.preparation
  if (!prep) { section.append(issues('当前输入缺项', state.missing)); return section }
  section.append(message(prep.scopeDescription), message(`参数包 ${prep.id} · 方案版本 ${prep.caseRevision}`),
    message(`扁管逻辑参数${(prep.status.tubeParametersComplete ?? prep.status.parametersComplete) ? '完整' : '不完整'} · 翅片核心几何${prep.status.finParametersComplete ? '完整' : '不完整'} · 冷媒目录选择${prep.status.refrigerantParametersComplete ? '完整' : '不完整'}`), issues('计算阻塞项', prep.blockers))
  for (const [group, values] of Object.entries(prep.parameters)) {
    if (group === 'refrigerant') {
      section.append(element('h4', '冷媒（确认快照）'), values ? refrigerantGeometry({ refrigerant: values, source: values.source,
        fields: state.snapshots[prep.refrigerantSnapshotId].fields }) : message('冷媒尚未确认，未生成介质参数'))
      continue
    }
    section.append(element('h4', group === 'geometry' ? '扁管截面几何（确认快照）' : group === 'finGeometry' ? '翅片几何（确认快照）' : '设计参数（已确认值）'),
      table(['参数', '值', '单位', '原值与来源'], Object.entries(values).map(([key, item]) => [
        (group === 'geometry' ? state.snapshots[prep.snapshotId]?.fields[item.source.catalogField]?.label : group === 'finGeometry' ? state.snapshots[prep.finSnapshotId]?.fields[item.source.catalogField]?.label : state.fields[key]?.label) ?? key,
        numberText(item.value), item.unit, `${item.original.value === null ? item.source.display || item.source.raw || '未知' : numberText(item.original.value)} ${item.original.unit} · ${item.source.cell ?? item.source.description}`])))
  }
  section.append(message('数值显示最多 12 位有效数字；完整值、原单位与换算规则见参数包。'))
  const raw = element('details'), summary = element('summary', '查看完整参数包与来源')
  raw.append(summary, element('pre', JSON.stringify(prep, null, 2), 'detail-text')); section.append(raw)
  return section
}
