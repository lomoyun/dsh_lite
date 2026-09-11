import { randomUUID } from 'node:crypto'
import { getRefrigerantRecord, summarizeRefrigerant } from './refrigerant-catalog.js'
import { REFRIGERANT_CONSTRAINT_FIELDS, REFRIGERANT_INPUT_FIELDS } from './refrigerant-fields.js'
import { conflict, McheError, object, pagination, text, within } from './validation.js'
import { constraintKeys, recommendationBasis } from './recommendation-context.js'
export function assessRefrigerant(record, state) {
  const checks = constraintKeys(state, 'refrigerant').map(field => {
    const definition = REFRIGERANT_INPUT_FIELDS[field], input = state.draft[field], expected = input.normalized.value
    const actual = definition ? record[definition.catalogField] : null
    const match = actual === null ? null : definition.text ? actual === expected : within(actual, expected)
    return { field, actual, expected, match, basis: state.confirmed[field] ? 'confirmed' : 'draft', source: input.source,
      message: definition ? `${definition.label}按原表明确值比较` : '工况与介质适用性未验证' }
  })
  const unknown = checks.filter(c => c.match === null)
  if (state.draft.refrigerantConcentration && !state.draft.refrigerantConcentrationBasis) unknown.push({ field: 'refrigerantConcentrationBasis', message: '只给浓度百分数尚不能确定质量/体积基准，不能自动合并Vol.和Wt.' })
  unknown.push({ message: '物性、材料兼容性、工况适用性及DLL映射未验证，不提供性能排名' })
  return { ...summarizeRefrigerant(record), satisfied: checks.filter(c => c.match === true), unmet: checks.filter(c => c.match === false), unknown }
}
export async function recommendRefrigerant(service, input) {
  object(input, ['sessionId', 'names', 'offset', 'limit'])
  const { offset, limit } = pagination(input)
  if (input.names !== undefined && (!Array.isArray(input.names) || !input.names.length || input.names.length > 100)) throw new McheError('比较介质应为1到100个精确标识')
  return service.decorate(await service.store.update(input.sessionId, {}, async state => {
    const catalog = await service.refrigerantCatalog()
    const records = input.names ? [...new Set(input.names)].map(name => getRefrigerantRecord(catalog, name).refrigerant) : Object.values(catalog.byName)
    const assessed = records.map(r => assessRefrigerant(r, state)), matches = input.names ? assessed : assessed.filter(r => !r.unmet.length)
    const conditions = REFRIGERANT_CONSTRAINT_FIELDS.filter(k => state.draft[k])
    state.refrigerantCandidates = { id: randomUUID(), component: 'refrigerant', inputVersion: state.componentVersions.refrigerant,
      basisSummary: recommendationBasis(await service.requirements.checkedState(state), 'refrigerant', catalog.catalogDigest),
      catalogDigest: catalog.catalogDigest, ...(input.names ? { names: [...new Set(input.names)] } : {}),
      basis: !conditions.length ? 'no_conditions' : conditions.some(k => !state.confirmed[k]) ? 'draft' : 'confirmed',
      policy: '仅按目录明确类别和浓度比较，质量与体积浓度不可互换；保留目录顺序，不作物性或性能排名',
      total: matches.length, excluded: assessed.length - matches.length, nextOffset: offset + limit < matches.length ? offset + limit : null, items: matches.slice(offset, offset + limit) }
  }))
}
export async function proposeRefrigerant(service, input) {
  object(input, ['sessionId', 'name', 'reason', 'revision']); text(input.reason, 300)
  return service.decorate(await service.store.update(input.sessionId, input, async state => {
    const catalog = await service.refrigerantCatalog(), { refrigerant } = getRefrigerantRecord(catalog, input.name)
    for (const p of state.proposals) if (p.component === 'refrigerant' && p.status === 'pending') p.status = 'stale'
    state.proposals.push({ id: randomUUID(), component: 'refrigerant', sessionId: state.sessionId, name: refrigerant.name,
      status: 'pending', inputVersion: state.inputVersion, componentVersion: state.componentVersions.refrigerant,
      catalogDigest: catalog.catalogDigest, reason: input.reason, assessment: assessRefrigerant(refrigerant, state), createdAt: new Date().toISOString() })
  }))
}
export async function confirmRefrigerant(service, input) {
  object(input, ['sessionId', 'revision', 'proposalId'])
  return service.decorate(await service.store.update(input.sessionId, { ...input, requireRevision: true }, async state => {
    const p = state.proposals.find(p => p.id === input.proposalId)
    if (!p || p.component !== 'refrigerant' || p.sessionId !== input.sessionId || p.status !== 'pending' || p.componentVersion !== state.componentVersions.refrigerant) throw conflict('冷媒建议已处理或失效，请重新建议')
    const catalog = await service.refrigerantCatalog()
    if (catalog.catalogDigest !== p.catalogDigest) throw conflict('冷媒目录已更新，请重新查询和建议')
    const snapshot = { id: randomUUID(), ...getRefrigerantRecord(catalog, p.name), createdAt: new Date().toISOString() }
    state.snapshots[snapshot.id] = snapshot; p.status = 'confirmed'; p.confirmedAt = snapshot.createdAt
    state.selections.refrigerant = { name: p.name, sequence: snapshot.refrigerant.sequence, category: snapshot.refrigerant.category,
      proposalId: p.id, snapshotId: snapshot.id, confirmed: true, confirmedAt: snapshot.createdAt, invalidReason: null }
    state.preparation = null; recheckRefrigerant(state)
  }))
}
export function recheckRefrigerant(state, changed = []) {
  const selected = state.selections.refrigerant
  if (!selected?.confirmed) return
  const assessment = assessRefrigerant(state.snapshots[selected.snapshotId].refrigerant, state)
  const affected = [...assessment.unmet, ...assessment.unknown.filter(r => changed.includes(r.field))]
  if (affected.length) { selected.confirmed = false; selected.invalidReason = '冷媒不满足或无法核实变更条件，请重新选择并确认' }
}
export function refrigerantBlockers(state) {
  const selected = state.selections.refrigerant, blockers = []
  if (!selected?.confirmed) blockers.push({ code: 'refrigerant_unconfirmed', message: selected?.invalidReason ?? '冷媒/载冷剂尚未确认' })
  for (const field of REFRIGERANT_CONSTRAINT_FIELDS) if (state.draft[field] && !state.confirmed[field]) blockers.push({ field, code: 'refrigerant_input_unconfirmed', message: '冷媒条件尚未确认' })
  if (selected) blockers.push(...assessRefrigerant(state.snapshots[selected.snapshotId].refrigerant, state).unknown.filter(r => r.field).map(r => ({ ...r, code: 'refrigerant_constraint_unknown' })))
  return blockers
}
export function preparedRefrigerant(state) {
  const selected = state.selections.refrigerant, snapshot = state.snapshots[selected?.snapshotId]
  if (!selected?.confirmed || !snapshot) return null
  return { snapshotId: snapshot.id, catalogDigest: snapshot.catalogDigest, source: snapshot.source, ...snapshot.refrigerant,
    dllFluidIdentifier: null, dllMappingReady: false }
}
