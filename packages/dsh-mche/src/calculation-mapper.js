import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { CALCULATION_FIELDS } from './calculation-fields.js'
import { boundaryBlockers, activeKeys } from './requirements-boundary.js'
import { PTM_KEYS } from './requirements-fields.js'
import { REQUIREMENTS_RULES } from './requirements-version.js'
import { projectTopology, topologyLayout, applyTopology } from './calculation-topology.js'

export const CONTRACT = JSON.parse(readFileSync(new URL('./worker/contract.json', import.meta.url), 'utf8'))
function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, sorted(value[k])]))
  return value
}
export const digest = value => createHash('sha256').update(JSON.stringify(sorted(value))).digest('hex')
export const PROFILE_DIGEST = digest(CONTRACT)
export const TOPOLOGY_CONTRACT = JSON.parse(readFileSync(new URL('./worker/topology-contract.json', import.meta.url), 'utf8'))
export const TOPOLOGY_DIGEST = digest({ base: CONTRACT, topology: TOPOLOGY_CONTRACT })
// Include the deterministic mapping implementation so a rule edit invalidates old confirmations even before a release bump.
export const MAPPER_DIGEST = digest({ profile: PROFILE_DIGEST, mapper: readFileSync(new URL('./calculation-mapper.js', import.meta.url), 'utf8'),
  topology: TOPOLOGY_DIGEST, topologyMapper: readFileSync(new URL('./calculation-topology.js', import.meta.url), 'utf8'),
  fields: readFileSync(new URL('./calculation-fields.js', import.meta.url), 'utf8'),
  worker: ['worker.py','topology_validation.py','native_binding.py','mche_driver.py'].map(name=>readFileSync(new URL('./worker/'+name,import.meta.url),'utf8')) })
export const emptyCalculation = () => ({ revision: 0, draft: {}, confirmation: null, preparation: null })
export function inputDigest(state) {
  // Selection constraints already revalidate the selections. Unused logical display fields
  // (for example tubePitch) must not invalidate otherwise identical native inputs.
  return digest({ profile: PROFILE_DIGEST, mapper: MAPPER_DIGEST, draft: state.calculation?.draft ?? {},
    topology: projectTopology(state.calculation),
    boundary: state.calculation?.boundary ?? null, requirements: state.requirements?.document ? {
      rules: REQUIREMENTS_RULES, revision: state.requirements.revision,
      sourceInvalid: state.requirements.sourceCheck?.valid === false,
      snapshotId: state.calculation?.requirementsSnapshot?.id ?? null, digest: state.calculation?.requirementsSnapshot?.digest ?? null } : null,
    selections: Object.fromEntries(['tube', 'fin', 'refrigerant'].map(k => [k, {
      selection: state.selections[k], snapshot: state.snapshots[state.selections[k]?.snapshotId] ?? null,
    }])) })
}
export function mapCalculation(state) {
  const calculation = state.calculation ?? emptyCalculation(), draft = calculation.draft
  const topology = projectTopology(calculation), layout = topologyLayout(topology)
  const multi = topology.rows.length > 1 || layout.passes.length > 1
  const profile = multi ? TOPOLOGY_CONTRACT : CONTRACT, profileDigest = multi ? TOPOLOGY_DIGEST : PROFILE_DIGEST
  const blockers = boundaryBlockers(state), provenance = [], warnings = []
  const block = (code, message, field) => blockers.push({ code, message, ...(field ? { field } : {}) })
  blockers.push(...layout.blockers)
  const values = Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, v.normalized]))
  for (const [key, spec] of Object.entries(CALCULATION_FIELDS)) {
    if (['tubeCount', 'refDirection'].includes(key)) continue
    if (spec.required && !draft[key] && (!state.requirements?.document || !PTM_KEYS.includes(key) || activeKeys(calculation.boundary).includes(key))) block('calculation_missing', `请提供${spec.label}`, key)
  }
  const snapshots = Object.fromEntries(['tube', 'fin', 'refrigerant'].map(k => {
    if (!state.selections[k]?.confirmed) block(`${k}_unconfirmed`, `${k} 选择尚未确认或已失效`)
    return [k, state.snapshots[state.selections[k]?.snapshotId]]
  }))
  const tube = snapshots.tube?.tube, fin = snapshots.fin?.fin, ref = snapshots.refrigerant?.refrigerant
  const binding = ref && CONTRACT.fluidBindings[ref.name]
  if (!binding || ref.categoryKey === 'eg' || ref.categoryKey === 'pg' || ref.concentrationPercent !== null) {
    block('dll_refrigerant_mapping_unverified', '该精确介质/浓度尚无已验证的物性绑定；目录序号不作 DLL 编码')
  }
  if (values.portShape && values.portShape !== 'rectangular') block('dll_port_shape_unverified', '首版仅验证均匀矩形孔；圆孔、指定截面和非均匀孔保留待验证', 'portShape')
  if (values.finStructure && values.finStructure !== 'louver') block('dll_fin_structure_unverified', '首版仅验证均匀百叶窗翅片；不能按目录名称推断结构', 'finStructure')
  function adopt(key, component, catalogKey, unit, nativePath) {
    const snapshot = snapshots[component], record = snapshot?.[component]
    const original = record?.geometry?.[catalogKey] ?? null
    const entry = draft[key], factor = unit === 'm' ? 0.001 : 1
    const value = entry ? entry.normalized : typeof original === 'number' ? original * factor : null
    const spec = CALCULATION_FIELDS[key]
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (value === 0 && spec?.exclusiveMin !== false) || (spec?.integer && !Number.isSafeInteger(value))) {
      block('geometry_unknown', `${spec?.label ?? key}缺少当前映射使用的明确数值`, key)
    }
    provenance.push({ field: key, nativePath, snapshotId: snapshot?.id, catalogField: catalogKey,
      original: { value: original, unit: unit === 'm' ? 'mm' : unit, evidence: record?.evidence?.[catalogKey] ?? null }, adopted: { value, unit },
      conversion: entry ? { factor: spec.units[entry.unit][0], offset: spec.units[entry.unit][1] } : { factor, offset: 0 },
      source: entry ?? { kind: 'catalog', catalogDigest: snapshot?.catalogDigest, source: snapshot?.source } })
    return value
  }
  const t = {
    width: adopt('tubeWidth', 'tube', 'widthMm', 'm', 'tube.4'), height: adopt('tubeHeight', 'tube', 'heightMm', 'm', 'tube.3'),
    ports: adopt('portCount', 'tube', 'portCount', 'count', 'tube.6'),
    portWidth: adopt('portWidth', 'tube', 'portWidthMm', 'm', 'tube.8'), portHeight: adopt('portHeight', 'tube', 'portHeightMm', 'm', 'tube.7'),
  }
  const f = {
    thickness: adopt('finThickness', 'fin', 'thicknessMm', 'm', 'fin.5'),
    height: adopt('finHeight', 'fin', values.finHeightBasis, 'm', 'fin.3'),
    depth: adopt('finDepth', 'fin', values.finDepthBasis, 'm', 'fin.4'),
    louverLength: adopt('louverLength', 'fin', values.louverLengthBasis, 'm', 'fin.7'),
    angle: adopt('louverAngle', 'fin', 'louverAngleDeg', 'degree', 'fin.8'),
    pitch: adopt('louverPitch', 'fin', 'louverPitchMm', 'm', 'fin.9'),
    count: adopt('louverCount', 'fin', 'louverCount', 'count', 'fin.6'),
  }
  for (const [key, basis] of [['finHeight','finHeightBasis'], ['finDepth','finDepthBasis'], ['louverLength','louverLengthBasis']]) {
    if (draft[key] && values[basis] !== 'supplement') block('geometry_basis_conflict', `${CALCULATION_FIELDS[key].label}已填写，请明确选择工程补充作为取值依据`, basis)
  }
  let fpi = null
  if (values.finPitchBasis === 'fpi') {
    fpi = values.finFpi
    if (!fpi) block('calculation_missing', '请提供 FPI 及依据', 'finFpi')
  } else {
    const pitch = adopt('finPitch', 'fin', 'finPitchMm', 'm', 'fin.2')
    if (values.finPitchBasis && pitch) fpi = 0.0254 / (pitch + (values.finPitchBasis === 'clear_gap' ? f.thickness : 0))
  }
  provenance.push({ field: 'finFpi', nativePath: 'fin.2', adopted: { value: fpi, unit: '1/in' },
    source: draft.finFpi ?? draft.finPitchBasis, conversion: { rule: values.finPitchBasis ?? 'unconfirmed', thicknessUsed: values.finPitchBasis === 'clear_gap' ? f.thickness : null } })
  if (t.portHeight && t.height && t.portHeight >= t.height) block('catalog_conflict', '采用孔高必须小于管高', 'portHeight')
  if (t.width && t.portWidth && t.ports && t.portWidth * t.ports >= t.width) block('catalog_conflict', '矩形孔总宽度必须小于管宽', 'portWidth')
  if (f.thickness && f.height && f.thickness >= f.height) block('catalog_conflict', '翅片厚度必须小于高度', 'finThickness')
  // REC computes its flow area from each rectangular port. A conflicting catalog area cannot be silently replaced.
  if (tube?.geometry.flowAreaMm2 != null && t.portWidth && t.portHeight && t.ports) {
    const rectangularArea = t.portWidth * t.portHeight * t.ports
    const catalogArea = tube.geometry.flowAreaMm2 * 1e-6
    if (Math.abs(rectangularArea - catalogArea) > Math.max(catalogArea * 1e-8, 1e-14)) {
      block('rectangular_area_conflict', '矩形孔模型的总流通面积与目录值不一致；保留原面积，需核对孔型或验证指定截面映射后再计算', 'portShape')
    }
    provenance.push({ field: 'flowArea', nativePath: 'tube.13 (inactive for REC)',
      original: { value: tube.geometry.flowAreaMm2, unit: 'mm2', evidence: tube.evidence.flowAreaMm2 },
      adopted: { value: rectangularArea, unit: 'm2' }, source: 'REC geometry check only; catalog is not overwritten' })
  }
  if (fin?.section !== 'main') warnings.push('翅片下部分区单位及结构须以本次用户工程核对依据为准。')
  for (const [component, record] of [['tube', tube], ['fin', fin], ['refrigerant', ref]]) {
    if (record?.review?.length) warnings.push(`${component} 原表 review 已随确认快照保留；与本 Profile 无关的字段未补零。`)
  }
  const fingerprint = inputDigest(state)
  const confirmed = calculation.confirmation?.digest === fingerprint
  if (!confirmed) block('calculation_unconfirmed', '计算工况或工程核对尚未确认，或相关输入/快照/规则已改变')
  const native = blockers.some(b => b.code !== 'calculation_unconfirmed') ? null : {
    profileId: profile.id, profileDigest, mapperVersion: profile.mapperVersion,
    general: [...CONTRACT.settings.general],
    tube: [0, values.tubeCount, values.finnedLength, t.height, t.width, 0, t.ports, t.portHeight, t.portWidth, values.unfinnedLength,
      ...Array(60).fill(0)],
    fin: [0, 1, fpi, f.height, f.depth, f.thickness, f.count, f.louverLength, f.angle, f.pitch,
      ...Array.from({ length: 40 }, (_, i) => i % 10 === 1 ? 1 : 0)],
    fin_conductivity: values.finConductivity, interlaced: [...CONTRACT.settings.interlaced], non_uniform_type: 0,
    connection: [[0,1,0],[-1,0,1],[0,-1,0]], header: [[1, values.tubeCount, values.refDirection === 'left' ? 1 : -1, 0]],
    refrigerant_flow_type: 0, residual: [...CONTRACT.settings.residual], refrigerant_name: binding.cRef,
    refrigerant: [binding.numericSlot, 0, 0, values.refPressure, values.refTemperature, 0, values.refMassFlow, 0, 0, 0, 0, 0, 0, 0, 0],
    uniform_refrigerant_distribution: true, air_flow_direction: values.airDirection === 'left_to_right' ? 1 : -1,
    air: [0, values.airPressure, values.airTemperature, values.airHumidity, 0, 1, values.airVolumeFlow, 0],
    automatic_correlation: false, correlation: [...CONTRACT.settings.correlation], dehumidification: [...CONTRACT.settings.dehumidification],
    resistance_model: 0, resistance: Array(6).fill(0), fan_coefficients: Array(10).fill(0), result_slots: Array(64).fill(0),
  }
  if (native) applyTopology(native, topology, layout)
  provenance.push({ field: 'topology', nativePath: 'general.1/general.9/tube/header/connection', source: topology.source,
    original: topology, adopted: { rowCounts: layout.rowCounts, header: layout.header, connection: layout.connection } })
  // Mapping may be inspectable while execution is blocked by missing engineering evidence.
  if (topology.connection === 'parallel' && topology.rows.length > 1) block('dll_parallel_distribution_unverified', '并联分配算法缺少 DLL 工程依据；结构及矩阵可核对，正式执行暂不放行')
  warnings.push('当前 DLL 第42/43输出槽存在 NaN 验收阻塞；参数就绪与真实工程验证分开，任何非有限结果仍判失败。')
  for (const [key, nativePath] of Object.entries({ refPressure:'refrigerant.3',refTemperature:'refrigerant.4',refMassFlow:'refrigerant.6',
    airPressure:'air.1',airTemperature:'air.2',airHumidity:'air.3',airVolumeFlow:'air.6',tubeCount:'tube.1',finnedLength:'tube.2',unfinnedLength:'tube.9',finConductivity:'fin_conductivity' })) {
    if (draft[key]) provenance.push({ field:key,nativePath,original:draft[key],adopted:{value:values[key],unit:CALCULATION_FIELDS[key].normalizedUnit},conversion:CALCULATION_FIELDS[key].units[draft[key].unit],source:draft[key] })
  }
  for (const [key,nativePath,value] of [['refDirection','header.0.2',values.refDirection === 'left' ? 1 : -1],['airDirection','air_flow_direction',values.airDirection === 'left_to_right' ? 1 : -1]]) {
    if(draft[key])provenance.push({field:key,nativePath,original:draft[key],adopted:{value,unit:'enum'},source:draft[key]})
  }
  return { profileId: profile.id, profileDigest, mapperVersion: profile.mapperVersion, mapperDigest: MAPPER_DIGEST, fingerprint,
    topology, topologyLayout: layout, engineeringVerified: false,
    confirmed, mappingReady: Boolean(native), native, provenance, blockers, warnings,
    snapshotIds: Object.fromEntries(Object.entries(snapshots).map(([k,s])=>[k,s?.id ?? null])) }
}
