import { CONDENSER_MAPPING } from './requirements-mapping.js'

const present = entry => typeof entry?.normalized === 'number' && Number.isFinite(entry.normalized)

// Recompute from effective entries on every read/update; never reuse a cached SH.
export function deriveSuperheat(entries, fieldIssues) {
  const rule = CONDENSER_MAPPING.superheat
  const sources = rule.inputs.map(field => ({ field, entry: entries[field] ?? null, issues: fieldIssues[field] ?? [] }))
  const issues = [], explicit = entries.refSuperheat ? structuredClone(entries.refSuperheat) : null
  let calculated = null
  if (sources.some(s => !present(s.entry))) issues.push('入口温度或冷凝温度缺失/无效，无法计算 SH')
  else {
    const difference = sources[0].entry.normalized - sources[1].entry.normalized
    const roundoff = 4 * Number.EPSILON * Math.max(...sources.map(s => Math.abs(s.entry.normalized)))
    if (!Number.isFinite(difference) || difference < -roundoff) issues.push('入口温度低于冷凝温度或温差无效，SH 待核')
    else calculated = Math.abs(difference) <= roundoff ? 0 : Number(difference.toPrecision(12))
  }
  const conflict = calculated !== null && present(explicit) && Math.abs(explicit.normalized-calculated) > rule.toleranceK
  if (conflict) issues.push(`明确填写的 SH 与派生值 ${calculated} K 冲突；请修改明确 SH 或来源温度，清除明确 SH 可采用派生值`)
  const derivation = { ...rule, sources, calculated, explicit, conflict, issues }
  if (!explicit) {
    entries.refSuperheat = { value: calculated, unit: 'K', normalized: calculated, normalizedUnit: 'K', derived: true,
      source: sources.map(s => `${s.field}: ${s.entry?.source ?? '未填写'}`).join('；').slice(0, 1200),
      derivation: { id: rule.id, formula: rule.formula, inputs: rule.inputs } }
    fieldIssues.refSuperheat = [...issues]
  } else if (conflict) {
    // Preserve the explicit adopted value; neither conflicting value may become an input.
    entries.refSuperheat = { ...explicit, normalized: null }
    fieldIssues.refSuperheat = [...(fieldIssues.refSuperheat ?? []), ...issues]
  } else fieldIssues.refSuperheat = [...(fieldIssues.refSuperheat ?? []), ...issues]
  return derivation
}
