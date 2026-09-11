import { REQUIREMENT_FIELDS, normalizeRequirement } from './requirements-fields.js'
import { REQUIREMENTS_RULES } from './requirements-version.js'
import { deriveSuperheat } from './requirements-derived.js'
import { profileDraft } from './requirements-mapping.js'

const mode = (label, fields) => ({ label, fields })
export const REFRIGERANT_MODES = {
  ptm: mode('入口 P&T&M', ['refPressure', 'refTemperature', 'refMassFlow']),
  pxm: mode('入口 P&X&M', ['refPressure', 'refQuality', 'refMassFlow']),
  ptsc: mode('入口 P&T＋出口 SC', ['refPressure', 'refTemperature', 'refSubcooling']),
  ptt: mode('入口 P&T＋出口 T', ['refPressure', 'refTemperature', 'refOutletTemperature']),
  tsat_sh_m: mode('入口 Tsat&SH&M', ['refSatTemperature', 'refSuperheat', 'refMassFlow']),
  tsat_sh_sc: mode('入口 Tsat&SH＋出口 SC', ['refSatTemperature', 'refSuperheat', 'refSubcooling']),
  tsat_sh_t: mode('入口 Tsat&SH＋出口 T', ['refSatTemperature', 'refSuperheat', 'refOutletTemperature']),
}
export const AIR_MODES = {
  ptrh: mode('空气 P&T&RH（相对湿度）', ['airPressure', 'airTemperature', 'airHumidity']),
  ptwb: mode('空气 P&T&Twb（湿球温度）', ['airPressure', 'airTemperature', 'airWetBulb']),
  ptx: mode('空气 P&T&X（含湿量）', ['airPressure', 'airTemperature', 'airHumidityRatio']),
}
export const FLOW_MODES = {
  volume: mode('体积流量', ['airVolumeFlow']), velocity: mode('迎面风速', ['airVelocity']),
}
export const modeSupported = b => b?.refrigerant === 'ptm' && b?.air === 'ptrh' && b?.flow === 'volume'
export const activeKeys = b => b ? [...(REFRIGERANT_MODES[b.refrigerant]?.fields ?? []), ...(AIR_MODES[b.air]?.fields ?? []), ...(FLOW_MODES[b.flow]?.fields ?? [])] : []
export const emptyRequirements = () => ({ revision: 0, document: null, edits: {}, supplements: {}, boundary: null, confirmation: null })

export function effectiveRequirements(requirements) {
  const entries = {}, rows = [], fieldIssues = {}, occurrences = {}
  for (const record of requirements.document?.records ?? []) {
    const changed = Object.hasOwn(requirements.edits, record.id)
    const parsed = changed ? normalizeRequirement(record.key, requirements.edits[record.id]) : { entry: record.adopted, issues: record.issues }
    const entry = parsed.entry && { ...parsed.entry, recordId: record.id, evidence: record.source }
    if (entry) {
      entries[record.key] = entry
      ;(occurrences[record.key] ??= []).push(record.id)
      fieldIssues[record.key] = [...(fieldIssues[record.key] ?? []), ...parsed.issues]
    }
    rows.push({ ...record, current: entry, currentIssues: parsed.issues, edited: changed })
  }
  for (const [key, value] of Object.entries(requirements.supplements)) {
    const parsed = normalizeRequirement(key, value)
    if (parsed.entry) entries[key] = { ...parsed.entry, supplement: true }
    fieldIssues[key] = parsed.issues
  }
  for (const [key, ids] of Object.entries(occurrences)) if (ids.length > 1) {
    const issue = `重复字段 ${ids.join('、')}；请明确一项采用值，清除其余采用值（原文保留）`
    entries[key] = { ...entries[key], normalized: null }
    fieldIssues[key] = [...fieldIssues[key], issue]
    for (const row of rows.filter(row => ids.includes(row.id))) row.currentIssues = [...row.currentIssues, issue]
  }
  const derived = requirements.document ? [deriveSuperheat(entries, fieldIssues)] : []
  return { entries, rows, fieldIssues, derived }
}
const present = (entries, key) => entries[key]?.normalized !== null && entries[key]?.normalized !== undefined
export function boundaryAssessment(requirements) {
  const { entries, rows, fieldIssues, derived } = effectiveRequirements(requirements), boundary = requirements.boundary, keys = activeKeys(boundary)
  const missing = keys.filter(key => !present(entries, key)).map(key => ({ field: key, message: `请补填${REQUIREMENT_FIELDS[key].label}及明确单位/依据` }))
  const inputs = Object.fromEntries(keys.filter(key => present(entries, key)).map(key => [key, entries[key]]))
  const validModes = boundary && REFRIGERANT_MODES[boundary.refrigerant] && AIR_MODES[boundary.air] && FLOW_MODES[boundary.flow]
  if (!validModes) missing.unshift({ field: 'boundary', message: '请选择一套冷媒、空气状态及流量模式' })
  if (present(entries, 'airWetBulb') && keys.includes('airWetBulb') && entries.airWetBulb.normalized > entries.airTemperature?.normalized) missing.push({ field: 'airWetBulb', message: '湿球温度不能高于干球温度，请核对' })
  const classify = key => keys.includes(key) ? 'calculation_input' : REQUIREMENT_FIELDS[key]?.target || ['refSubcooling', 'refOutletTemperature'].includes(key) ? 'design_target' : key === 'testConditions' ? 'test_reference' : 'reference'
  const assessment = { boundary, keys, entries, inputs, fieldIssues, derived, rows: rows.map(r => ({ ...r, role: classify(r.key) })),
    confirmationBlockers: derived.filter(d => d.conflict).map(d => ({ field: d.field, message: d.issues.at(-1) })),
    roles: Object.fromEntries(Object.keys(REQUIREMENT_FIELDS).concat(Object.keys(entries)).map(key => [key, classify(key)])), missing,
    inputComplete: Boolean(validModes && !missing.length), executionSupported: Boolean(validModes && modeSupported(boundary)),
    executionMessage: modeSupported(boundary) ? 'PTM / 空气 P&T&RH / 体积流量已接入；仍需部件及工程核对。'
      : '该模式可填写和确认，执行尚未接入。当前计算端仅支持 PTM / 空气 P&T&RH / 体积流量。',
    notes: ['主工况与测试条件分别保存，不用测试空气温度覆盖主工况。', '目标换热量不反推质量流量，空间尺寸不代替管长或迎风面积，空气夹角不代替流向枚举。', 'SH = 入口温度 − 冷凝温度，统一到 K 后计算；不推算压力与饱和温度的物性关系。SC 保存非负温差。', '质量流量与出口目标按所选模式分别生效，其他已填值保留；体积流量与风速不按空间尺寸换算。'] }
  return { ...assessment, profileDraft: profileDraft(assessment) }
}
export function recommendBoundary(requirements) {
  const { entries } = effectiveRequirements(requirements)
  const rank = modes => Object.entries(modes).map(([id, spec]) => {
    const supplied = spec.fields.filter(key => present(entries, key)), missing = spec.fields.filter(key => !present(entries, key))
    return { id, ...spec, supplied, missing, reasons: supplied.map(key => ({ field: key, value: entries[key].value, unit: entries[key].unit, source: entries[key].source })),
      explanation: `已提供${supplied.length}/${spec.fields.length}项${missing.length ? `；缺少${missing.map(key => REQUIREMENT_FIELDS[key].label).join('、')}` : '，无需工程推算'}` }
  }).sort((a, b) => a.missing.length-b.missing.length)
  const refrigerant = rank(REFRIGERANT_MODES), air = rank(AIR_MODES), flow = rank(FLOW_MODES)
  return { proposed: { refrigerant: refrigerant[0].id, air: air[0].id, flow: flow[0].id }, refrigerant, air, flow,
    basis: '仅按现有明确字段覆盖情况推荐，等价组合保留为备选；仍待用户选择确认。' }
}

// All thermodynamic fields are controlled by one selected mode; inactive values stay in requirements only.
export function boundaryBlockers(state) {
  const req = state.requirements, boundary = state.calculation?.boundary, blockers = []
  if (!req?.document) return blockers
  const block = (code, message, field) => blockers.push({ code, message, ...(field ? { field } : {}) })
  if (!req.confirmation || req.confirmation.revision !== req.revision || req.confirmation.rulesDigest !== REQUIREMENTS_RULES || !state.calculation.requirementsSnapshot) block('requirements_unconfirmed', '客户需求、Boundary 或读取规则已改变，请在客户需求页核对差异并确认')
  if (req.document.rulesDigest !== REQUIREMENTS_RULES) block('requirements_mapping_stale', '映射规则已更新，请重新读取原表后核对')
  if (req.sourceCheck?.valid === false) block('requirements_source_changed', req.sourceCheck.message)
  if (!boundary || !modeSupported(boundary)) block('boundary_unsupported', '当前 Boundary 执行尚未接入；不能沿用旧 PTM 参数包')
  const assessment = boundaryAssessment(req)
  for (const item of assessment.missing) block('boundary_missing', item.message, item.field)
  const expected = assessment.entries.refrigerant?.normalized
  if (expected && expected !== state.selections.refrigerant?.name) block('requirements_refrigerant_mismatch', `需求介质为 ${expected}，请独立确认对应冷媒选择；不自动替换介质`)
  return blockers
}
