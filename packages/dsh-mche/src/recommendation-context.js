import { createHash } from 'node:crypto'
import { INPUT_FIELDS, CONSTRAINT_FIELDS } from './inputs.js'
import { FIN_CONSTRAINT_FIELDS } from './fin-fields.js'
import { REFRIGERANT_CONSTRAINT_FIELDS } from './refrigerant-fields.js'
import { effectiveRequirements } from './requirements-boundary.js'
import { digest } from './calculation-mapper.js'
import { REQUIREMENTS_RULES } from './requirements-version.js'

const fields = { tube: CONSTRAINT_FIELDS, fin: FIN_CONSTRAINT_FIELDS, refrigerant: REFRIGERANT_CONSTRAINT_FIELDS }
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const brief = value => typeof value === 'string' ? value.slice(0, 240) : value
export const constraintKeys = (state, component) => fields[component].filter(key => state.draft[key])

// Only explicitly saved selection inputs filter a catalog. Customer requirements
// and selected parts provide context, never an inferred geometry/pressure filter.
export function recommendationContext(state) {
  const constraints = Object.keys(INPUT_FIELDS).filter(key => Object.values(fields).some(list => list.includes(key)) && state.draft[key]).sort().map(field => {
    const entry = state.draft[field]
    return { field, value: entry.normalized.value, unit: entry.normalized.unit, source: entry.source,
      basis: state.confirmed[field] ? 'confirmed' : 'draft', components: Object.keys(fields).filter(c => fields[c].includes(field)),
      filtering: field !== 'application' && field !== 'operatingConditions' }
  })
  const req = state.requirements
  const reviewed = req?.confirmation && req.sourceCheck?.valid !== false && req.confirmation.revision === req.revision && req.confirmation.digest === digest({
    rules: REQUIREMENTS_RULES, revision: req.revision, document: req.document, edits: req.edits, supplements: req.supplements, boundary: req.boundary })
  const references = req?.document ? Object.entries(effectiveRequirements(req).entries).sort(([a], [b]) => a.localeCompare(b)).map(([field, entry]) => ({
    field, value: entry.value, unit: entry.unit, source: entry.source, evidence: entry.evidence,
    role: field === 'testConditions' ? 'test_reference' : 'reference', basis: reviewed ? 'confirmed' : 'draft',
  })) : []
  if (state.draft.operatingConditions) references.push({ field: 'operatingConditions', ...state.draft.operatingConditions, role: 'reference' })
  const selected = Object.entries(state.selections).filter(([, s]) => s).map(([component, s]) => ({ component, name: s.name,
    confirmed: s.confirmed, snapshotId: s.snapshotId, catalogDigest: state.snapshots[s.snapshotId]?.catalogDigest }))
  const source = req?.document ? { ...req.document.source, rulesDigest: req.document.rulesDigest, valid: req.sourceCheck?.valid !== false } : null
  const boundary = req?.boundary ?? null
  const fingerprint = hash({ constraints, references, selected, source, boundary })
  return { version: 1, fingerprint, boundary, constraints: constraints.map(c => ({ ...c, source: brief(c.source), value: brief(c.value) })),
    references: references.map(r => ({ field: r.field, value: brief(r.value), unit: r.unit, source: brief(r.source),
      role: r.role, basis: r.basis, ...(r.evidence ? { evidence: { sheet: r.evidence.sheet, address: r.evidence.address } } : {}) })), selected, source,
    policy: '仅明确保存的约束参与目录比较；未确认约束为草稿。现用型号、应用、安装空间及已选部件是参考，不自动推导尺寸或耐压。目录比较不能证明项目适用性、装配、性能或安全余量。' }
}

export function recommendationBasis(state, component, catalogDigest) {
  const context = recommendationContext(state)
  const adopted = context.constraints.filter(c => c.components.includes(component))
  return { version: 1, contextDigest: context.fingerprint, catalogDigest, component,
    constraints: adopted, references: context.references, selected: context.selected, source: context.source, boundary: context.boundary,
    summary: adopted.filter(c => c.filtering).length ? '按已保存的明确约束比较，逐项结果见服务端核对；草稿依据尚待确认。' : '尚无明确筛选约束，仅浏览或比较指定型号，不能证明项目适用性。' }
}

export function recommendationStatus(record, context, catalogDigest) {
  if (!record) return record
  const reason = !record.basisSummary ? '旧记录缺少依据摘要，请重新比较；不使用当前条件解释历史推荐。'
    : record.basisSummary.contextDigest !== context.fingerprint ? '需求、约束或已选部件依据已变化，请重新比较。'
      : record.catalogDigest !== catalogDigest ? '目录已变化，请重新比较。' : record.stale ? '原推荐依据已变化，请重新比较。' : null
  return { ...record, stale: Boolean(reason), staleReason: reason }
}
