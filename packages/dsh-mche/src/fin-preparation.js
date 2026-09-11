import { FIN_CONSTRAINT_FIELDS } from './fin-fields.js'
import { finReviewGroups } from './fin-catalog.js'
import { assessFin } from './fin-recommendation.js'

export function finParameterBlockers(state) {
  const selected = state.selections.fin, snapshot = state.snapshots[selected?.snapshotId], blockers = []
  if (!selected?.confirmed) blockers.push({ code: 'fin_unconfirmed', message: selected?.invalidReason ?? '翅片型号尚未确认' })
  for (const field of FIN_CONSTRAINT_FIELDS) if (state.draft[field] && !state.confirmed[field]) blockers.push({ field, code: 'fin_input_unconfirmed', message: '翅片约束或工况尚未确认' })
  if (!snapshot) return blockers
  const fin = snapshot.fin, groups = finReviewGroups(fin)
  blockers.push(...groups.conflicts.map(item => ({ ...item, code: 'fin_catalog_conflict' })), ...groups.restrictions.map(item => ({ ...item, code: 'fin_source_restriction' })))
  const required = Object.keys(fin.geometry).filter(key => !['rMm', 'finPitchRangeMm', 'brazingChangeMm'].includes(key))
  for (const key of required) if (fin.geometry[key] === null) blockers.push({ code: 'fin_geometry_unknown', field: key, cell: fin.evidence[key]?.cell, message: `${snapshot.fields[key].label}尚无单一数值` })
  if (Object.values(snapshot.fields).some(field => field.group === 'geometry' && field.unitBasis === 'workbook_column_unit_inherited')) {
    blockers.push({ code: 'fin_units_unverified', message: '下部分区的单位继承尚未确认，不能直接作为正式计算单位' })
  }
  blockers.push(...assessFin(fin, state).unknown.filter(item => FIN_CONSTRAINT_FIELDS.includes(item.field) && state.draft[item.field])
    .map(item => ({ ...item, code: 'fin_constraint_unknown' })))
  return blockers
}
export function preparedFinGeometry(state) {
  const selected = state.selections.fin, snapshot = state.snapshots[selected?.snapshotId]
  if (!selected?.confirmed || !snapshot) return {}
  return Object.fromEntries(Object.entries(snapshot.fin.geometry).map(([key, value]) => {
    const field = snapshot.fields[key], certainUnit = field.unitBasis !== 'workbook_column_unit_inherited'
    const factor = field.unit === 'mm' ? 0.001 : 1
    // 单位依据未确认时仅保留原值，不能把继承单位的尺寸直接转成计算数值。
    return [key.replace(/Mm$/, '').replace(/Deg$/, ''), { value: certainUnit && value !== null ? value * factor : null,
      unit: field.unit === 'mm' ? 'm' : field.unit ?? '个', original: { value, unit: field.unit ?? '个' },
      conversion: { factor, rule: 'metric_units_only', applied: certainUnit && value !== null },
      source: { catalogField: key, snapshotId: snapshot.id, catalogDigest: snapshot.catalogDigest,
        path: snapshot.source.path, sha256: snapshot.source.sha256, sheet: snapshot.source.sheet, section: snapshot.fin.section,
        headerCell: field.headerCell, unitCell: field.unitCell, unitBasis: field.unitBasis, ...snapshot.fin.evidence[key] } }]
  }))
}
