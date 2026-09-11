import { CALCULATION_FIELDS } from './calculation-fields.js'
import { PTM_KEYS } from './requirements-fields.js'
import { modeSupported } from './requirements-boundary.js'

const categories = { data: '资料待核对', structure: '结构待确定', confirmation: '用户待确认', engineering: '工程／系统待验证' }
const components = { tube: '扁管', fin: '翅片', refrigerant: '冷媒' }
const semantic = { finHeight: 'finHeightBasis', finDepth: 'finDepthBasis', louverLength: 'louverLengthBasis', finPitch: 'finPitchBasis' }
export function boundaryCoverage(recommendation) {
  const modes = ['refrigerant', 'air', 'flow'].map(key => recommendation[key].find(m => m.id === recommendation.proposed[key]))
  const supplied = [...new Set(modes.flatMap(m => m.supplied))], missing = [...new Set(modes.flatMap(m => m.missing))]
  return { boundary: recommendation.proposed, supplied, missing, inputComplete: !missing.length,
    executionSupported: modeSupported(recommendation.proposed), executionMessage: modeSupported(recommendation.proposed)
      ? '推荐组合已接入输入映射；仍需部件、工程确认和运行环境检查，不能据此宣称计算成功。'
      : '推荐组合符合现有字段，执行尚未接入；不为迁就 PTM 接口改变求解问题。' }
}
export function engineeringGuidance(state) {
  const calc = state.calculation, req = state.requirements, hasRequirements = Boolean(req.document)
  const groups = Object.entries(categories).map(([id, label]) => ({ id, label, issues: [] })), seen = new Map()
  const add = (category, field, reason, source, impact, view, component, code = field) => {
    const key = `${category}:${field}`, old = seen.get(key)
    if (old) { if (!old.reasons.includes(reason)) old.reasons.push(reason); if (!old.sources.includes(source)) old.sources.push(source); return }
    const issue = { id: key, field, code, reasons: [reason], sources: [source], impact, entry: { view, ...(component ? { component } : {}) } }
    seen.set(key, issue); groups.find(g => g.id === category).issues.push(issue)
  }
  if (hasRequirements) {
    for (const item of req.assessment.missing) add(item.field === 'boundary' ? 'confirmation' : 'data', item.field, item.message,
      `requirements.assessment.entries.${item.field}`, '当前模式输入', 'requirements')
    for (const [field, issues] of Object.entries(req.assessment.fieldIssues)) for (const reason of issues) add('data', field, reason,
      req.assessment.entries[field]?.source ?? `requirements.document:${field}`, req.assessment.roles[field] === 'calculation_input' ? '当前模式输入' : '参考资料核对', 'requirements')
    if (!req.reviewed) add('confirmation', 'requirements', '需求草稿已保存，请核对采用值、模式和差异后确认。', 'requirements.reviewed', '应用需求快照', 'requirements')
  }
  for (const [component, label] of Object.entries(components)) {
    const selection = state.selections[component], snapshot = state.snapshots[selection?.snapshotId], record = snapshot?.[component]
    if (!selection?.confirmed) add(selection ? 'confirmation' : 'structure', component, selection?.invalidReason ?? `请确定并在页面确认${label}型号；可先浏览或比较。`,
      `selections.${component}`, '部件目录快照', selection ? 'selection' : 'candidates', component)
    if (record?.review?.length) add('data', `${component}.review`, `${label} ${record.name} 的目录 review 已保留，需逐项核对。`,
      `snapshots.${snapshot.id}.${component}.review`, '目录证据核对', 'selection', component)
  }
  for (const item of calc.blockers) {
    const { code } = item, field = item.field ?? code
    if (['tube_unconfirmed', 'fin_unconfirmed', 'refrigerant_unconfirmed', 'requirements_unconfirmed', 'boundary_missing'].includes(code)) continue
    if (hasRequirements && code === 'calculation_missing' && PTM_KEYS.includes(field)) continue // effective requirements own mode/input guidance
    if (code === 'boundary_unsupported') continue // current draft mode and recommendation below, not the last applied snapshot
    if (code === 'geometry_unknown') {
      const component = ['tubeWidth', 'tubeHeight', 'portWidth', 'portHeight', 'portCount'].includes(field) ? 'tube' : 'fin'
      if (!state.selections[component]) continue // select a component before requesting its catalog geometry
      if (semantic[field] && !calc.draft[semantic[field]]) continue // one semantic choice, not a duplicate numeric request
    }
    const category = code === 'calculation_unconfirmed' ? 'confirmation' : code.startsWith('requirements_') || code === 'calculation_missing' && PTM_KEYS.includes(field) ? 'data'
      : code === 'topology_missing' || code === 'calculation_missing' && CALCULATION_FIELDS[field]?.group === 'conditions' ? 'structure' : 'engineering'
    const view = category === 'structure' || code === 'calculation_missing' && PTM_KEYS.includes(field) ? 'conditions' : code.startsWith('requirements_') ? 'requirements' : 'engineering'
    const reason = field === 'finUnitEvidence' && state.selections.fin
      ? `${item.message}；目录原值和单位已保存，这里需要工程核对依据，无需重复输入目录单位。` : item.message
    add(category, field, reason, `calculation.blockers:${code}`, '正式计算', view, undefined, code)
  }
  const boundary = hasRequirements ? req.boundary : { refrigerant: 'ptm', air: 'ptrh', flow: 'volume' }
  const recommended = hasRequirements ? req.recommendation.combination : null
  const capabilities = [{ id: 'boundary', supported: modeSupported(boundary), message: !boundary ? '模式待选择；推荐组合的字段覆盖与执行支持分别核对。'
    : modeSupported(boundary) ? '当前组合已接入输入映射；仍需确认、映射及运行环境检查。' : '当前组合可保存和确认，执行尚未接入；保留求解问题，不为调用 PTM 改换模式。' },
  { id: 'native_validation', supported: false, message: '当前 DLL 第42/43输出槽 NaN 的工程验收阻塞仍存在；任何非有限结果均判失败。参数就绪不代表实际计算成功。' }]
  if (calc.topology.connection === 'parallel' && calc.topology.rows.length > 1) capabilities.push({ id: 'parallel', supported: false, message: '当前并联结构可编辑预览；DLL 并联执行及分配算法尚未验证。' })
  const prep = calc.preparation
  if (prep && !prep.stale && prep.runtime?.ready === false) add('engineering', 'runtime', prep.runtime.error ?? '运行环境不可用', 'calculation.preparation.runtime', '实际执行', 'preparation')
  const stages = { dataRead: hasRequirements, draftSaved: Boolean(req.revision || Object.keys(state.draft).length || calc.revision),
    requirementsConfirmed: Boolean(req.reviewed), componentsConfirmed: Object.values(state.selections).filter(s => s?.confirmed).length,
    calculationConfirmed: Boolean(calc.confirmed), mappingReady: Boolean(prep?.native && !prep.stale),
    calculationReady: Boolean(state.status.calculationReady), calculationSucceeded: calc.runs.some(r => r.status === 'succeeded' && !r.historical) }
  const actions = groups.filter(g => g.issues.length).slice(0, 3).map(g => ({ label: g.label, ...g.issues[0].entry }))
  const finSnapshot = state.snapshots[state.selections.fin?.snapshotId]
  const semanticChoices = finSnapshot ? ['finHeightBasis', 'finDepthBasis', 'louverLengthBasis', 'finPitchBasis'].map(field => ({
    field, label: CALCULATION_FIELDS[field].label, selected: calc.draft[field]?.value ?? null,
    options: Object.entries(CALCULATION_FIELDS[field].options).map(([value, label]) => {
      const key = field === 'finPitchBasis' && value !== 'fpi' ? 'finPitchMm' : value
      return { value, label, ...(Object.hasOwn(finSnapshot.fin.geometry, key) ? { original: {
        value: finSnapshot.fin.geometry[key], unit: finSnapshot.fields[key]?.unit ?? '', evidence: finSnapshot.fin.evidence[key],
      } } : {}) }
    }), message: '目录单位与原值已保留；DLL 取值含义仍须用户核对，不能由单位已知推定语义已验证。',
  })) : []
  return { version: 1, profileId: calc.profile.id, boundary: { selected: boundary, recommended }, stages, groups, capabilities,
    semanticChoices, suggestedActions: actions, details: { legacyMissing: state.missing, calculationBlockers: calc.blockers, warnings: calc.warnings },
    policy: '建议入口可自由使用，不要求固定工具顺序。型号确认仅保存目录快照，不等于工程验证或计算成功。' }
}
