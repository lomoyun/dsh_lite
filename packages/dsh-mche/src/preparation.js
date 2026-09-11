import { randomUUID } from 'node:crypto'
import { missingInputs, REQUIRED_FIELDS } from './inputs.js'
import { reviewGroups } from './catalog.js'
import { assessTube } from './recommendation.js'
import { CONSTRAINT_FIELDS } from './inputs.js'
import { FIN_INPUT_FIELDS } from './fin-fields.js'
import { finParameterBlockers, preparedFinGeometry } from './fin-preparation.js'
import { refrigerantBlockers, preparedRefrigerant } from './refrigerant-selection.js'

const factors = { mm: { factor: 0.001, unit: 'm' }, mm2: { factor: 0.000001, unit: 'm2' }, MPa: { factor: 1000000, unit: 'Pa' } }
const mappingBlockers = [
  ['dll_port_shape_unverified', '孔型和非均匀孔的 DLL 表达未核实'],
  ['dll_perimeter_unverified', '周长定义及换算规则未核实'],
  ['dll_area_semantics_unverified', '材料截面积、流通截面积与 DLL 面积参数的对应含义未核实'],
  ['dll_encoding_unverified', '管间距含义、DLL 编码、位置数组及完整工况契约未核实'],
].map(([code, message]) => ({ code, message }))
function converted(value, unit, source) {
  const mapping = factors[unit] ?? { factor: 1, unit: unit ?? '个' }
  return { value: value === null ? null : value * mapping.factor, unit: mapping.unit,
    original: { value, unit: unit ?? '个' }, conversion: { factor: mapping.factor, rule: 'metric_units_only' }, source }
}
export function parameterBlockers(state) {
  const blockers = missingInputs(state).filter(item => !Object.hasOwn(FIN_INPUT_FIELDS, item.field) && !item.field.startsWith('refrigerant'))
  const selected = state.selections.tube, snapshot = state.snapshots[selected?.snapshotId]
  if (!selected?.confirmed) blockers.push({ code: 'tube_unconfirmed', message: selected?.invalidReason ?? '扁管型号尚未确认' })
  if (!snapshot) return blockers
  const assessment = assessTube(snapshot.tube, state)
  blockers.push(...assessment.unknown.filter((item) => CONSTRAINT_FIELDS.includes(item.field)).map((item) => ({
    field: item.field, code: 'constraint_unknown', message: item.message,
  })))
  const { conflicts, unknownGeometry } = reviewGroups(snapshot.tube)
  blockers.push(...conflicts.map((item) => ({ ...item, code: 'catalog_conflict' })))
  blockers.push(...unknownGeometry.map((item) => ({ ...item, code: 'geometry_unknown' })))
  return blockers
}
export function statusOf(state) {
  const tubeParametersComplete = parameterBlockers(state).length === 0, finParametersComplete = finParameterBlockers(state).length === 0
  const refrigerantParametersComplete = refrigerantBlockers(state).length === 0
  return { tubeConfirmed: Boolean(state.selections.tube?.confirmed), finConfirmed: Boolean(state.selections.fin?.confirmed),
    refrigerantConfirmed: Boolean(state.selections.refrigerant?.confirmed), refrigerantParametersComplete,
    tubeParametersComplete, finParametersComplete, parametersComplete: tubeParametersComplete && finParametersComplete && refrigerantParametersComplete,
    assemblyCompatibilityVerified: false, dllMappingReady: false }
}
export function preparePackage(state) {
  const selected = state.selections.tube, snapshot = state.snapshots[selected?.snapshotId]
  const geometry = snapshot && selected.confirmed ? Object.fromEntries(Object.entries(snapshot.tube.geometry).map(([key, value]) =>
    [key.replace(/Mm2?$/, ''), converted(value, snapshot.fields[key].unit, { catalogField: key, snapshotId: snapshot.id, catalogDigest: snapshot.catalogDigest,
      ...snapshot.source, ...snapshot.tube.evidence[key] })])) : {}
  const design = Object.fromEntries(REQUIRED_FIELDS.filter((key) => state.confirmed[key]).map((key) => {
    const entry = state.confirmed[key]
    return [key, converted(entry.normalized.value, entry.normalized.unit,
      { description: entry.source, originalValue: entry.value, originalUnit: entry.unit, origin: entry.origin, confirmedAt: entry.confirmedAt })]
  }))
  return { schemaVersion: 1, id: randomUUID(), caseId: state.id, caseRevision: state.revision + 1,
    inputVersion: state.inputVersion, snapshotId: snapshot?.id ?? null, finSnapshotId: state.selections.fin?.snapshotId ?? null,
    refrigerantSnapshotId: state.selections.refrigerant?.snapshotId ?? null, scope: 'tube-fin-refrigerant-logical',
    scopeDescription: '完整仅指扁管逻辑参数、翅片核心几何及冷媒目录选择；原始规格保留，装配匹配、介质物性、完整工况和正式DLL映射尚未核实',
    status: statusOf(state), parameters: { geometry, design, finGeometry: preparedFinGeometry(state), refrigerant: preparedRefrigerant(state) }, confirmedConditions: state.confirmed,
    blockers: [...parameterBlockers(state), ...finParameterBlockers(state), ...refrigerantBlockers(state), ...mappingBlockers,
      { code: 'dll_refrigerant_mapping_unverified', message: '冷媒介质标识、物性库、浓度基准及DLL映射尚未核实；不将原表序号当作DLL编码' },
      { code: 'tube_fin_compatibility_unverified', message: '扁管/翅片结构匹配和管间距定义尚未核实，未按宽度相同等假设自动判定' },
      { code: 'dll_fin_mapping_unverified', message: '翅片R、范围、非均匀开窗、单位及DLL字段映射尚未核实' }],
    calculationReady: false, createdAt: new Date().toISOString() }
}
