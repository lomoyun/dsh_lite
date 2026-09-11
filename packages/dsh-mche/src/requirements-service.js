import { randomUUID } from 'node:crypto'
import { digest, inputDigest } from './calculation-mapper.js'
import { calculationChanges } from './calculation-fields.js'
import { BOUNDARY_KEYS, PTM_KEYS, REQUIREMENT_FIELDS, hasValue } from './requirements-fields.js'
import { REQUIREMENTS_RULES as RULES } from './requirements-version.js'
import { extractRequirements, requirementTables } from './requirements-parser.js'
import { AIR_MODES, FLOW_MODES, REFRIGERANT_MODES, boundaryAssessment, emptyRequirements, recommendBoundary } from './requirements-boundary.js'
import { conflict, McheError, object, text } from './validation.js'

function requirementDigest(req) { return digest({ rules: RULES, revision: req.revision, document: req.document, edits: req.edits, supplements: req.supplements, boundary: req.boundary }) }
function invalidate(state) {
  state.requirements.revision++; state.requirements.confirmation = null
  state.calculation.confirmation = null; state.calculation.preparation = null; state.preparation = null
}
function calculationDraft(state, assessment) {
  const draft = { ...state.calculation.draft }
  for (const key of PTM_KEYS) delete draft[key]
  for (const key of PTM_KEYS.filter(key => Object.hasOwn(assessment.inputs, key))) {
    const entry = assessment.inputs[key]
    draft[key] = calculationChanges({ [key]: { value: entry.normalized, unit: entry.normalizedUnit, source: entry.source } }, 'requirements')[key]
  }
  return draft
}
function adoptedEntry(entry, origin) {
  object(entry, ['value', 'unit', 'source'])
  if (!hasValue(entry.value)) return null
  if (!['number', 'string', 'boolean'].includes(typeof entry.value) || typeof entry.value === 'number' && !Number.isFinite(entry.value)) throw new McheError('填写值必须为有限数值或原文')
  if (String(entry.value).length > 4000 || typeof entry.unit !== 'string' || entry.unit.length > 60) throw new McheError('填写值或单位过长')
  text(entry.source, 1200)
  return { ...entry, origin }
}

export class RequirementsService {
  constructor(owner, excel) { this.owner = owner; this.excel = excel }
  excelService() {
    const excel = typeof this.excel === 'function' ? this.excel() : this.excel
    if (!excel) throw new McheError('Excel 理解服务不可用，请启用现有 Excel 插件', 503)
    return excel
  }
  async load(fileId, sessionId) {
    try {
      const excel = this.excelService(), data = await excel.store.load(fileId, sessionId)
      await excel.artifact({ fileId, sessionId, artifact: 'original' })
      return data
    } catch (error) { if (error.code === 'MCHE_INVALID') throw error; throw new McheError(error.message, error.status ?? 400) }
  }
  async checkedState(state) {
    if (!state.requirements?.document) return state
    let sourceCheck
    try {
      const { source } = state.requirements.document
      const { meta } = await this.load(source.fileId, state.sessionId)
      const valid = meta.sha256 === source.sha256 && meta.indexSha256 === source.indexSha256
      sourceCheck = { valid, message: valid ? '原件与索引摘要一致' : '需求原件或索引已变化，请重新读取并确认' }
    } catch (error) { sourceCheck = { valid: false, message: error.message } }
    return { ...state, requirements: { ...state.requirements, sourceCheck } }
  }
  view(state, catalog) {
    const req = state.requirements ?? emptyRequirements(), assessment = boundaryAssessment(req)
    const next = calculationDraft(state, assessment)
    const difference = [...new Set([...Object.keys(state.calculation.draft), ...Object.keys(next)])].filter(key => JSON.stringify(state.calculation.draft[key] ?? null) !== JSON.stringify(next[key] ?? null))
      .map(key => ({ field: key, before: state.calculation.draft[key] ?? null, after: next[key] ?? null }))
    const currentDigest = requirementDigest(req)
    const fields = { ...REQUIREMENT_FIELDS, ...Object.fromEntries((req.document?.records ?? []).filter(r => !REQUIREMENT_FIELDS[r.key]).map(r => [r.key, { label: r.originalName, text: true, unit: '' }])) }
    const expected = assessment.entries.refrigerant?.normalized
    const selected = state.selections.refrigerant?.name ?? null
    const match = catalog && typeof expected === 'string' && Object.hasOwn(catalog.byName, expected) ? catalog.byName[expected] : null
    const mappingStale = Boolean(req.document && req.document.rulesDigest !== RULES)
    return { ...req, fields, modes: { refrigerant: REFRIGERANT_MODES, air: AIR_MODES, flow: FLOW_MODES },
      assessment, profileDraft: assessment.profileDraft, recommendation: recommendBoundary(req), rulesDigest: RULES, mappingStale,
      refrigerantSuggestion: expected ? { requested: expected, selected, different: Boolean(selected && expected !== selected),
        exactMatch: match ? { name: match.name, category: match.category, concentrationPercent: match.concentrationPercent, concentrationBasis: match.concentrationBasis } : null,
        catalogDigest: catalog?.catalogDigest, message: match ? '按 Excel 介质标识精确匹配；请通过现有冷媒入口建议并确认选择。' : '目录尚无该精确介质标识；请核对需求或补充经核实资料，不自动替换近似冷媒。' } : null,
      reviewed: Boolean(req.sourceCheck?.valid !== false && req.confirmation?.digest === currentDigest && req.confirmation?.revision === req.revision),
      reviewId: digest({ sessionId: state.sessionId, revision: state.revision, requirements: currentDigest, calculation: inputDigest(state) }),
      difference, boundaryDifference: { before: state.calculation.boundary ?? (PTM_KEYS.some(key => state.calculation.draft[key]) ? { refrigerant: 'ptm', air: 'ptrh', flow: 'volume', legacy: true } : null), after: req.boundary },
      calculationRevision: state.calculation.revision }
  }
  async files(input) {
    object(input, ['sessionId'])
    return { files: (await this.excelService().store.list(input.sessionId)).map(({ fileId, name, status }) => ({ fileId, name, status })) }
  }
  async read(input) {
    object(input, ['sessionId', 'fileId', 'sheet', 'table', 'revision'])
    const { index, meta } = await this.load(input.fileId, input.sessionId)
    const candidates = requirementTables(index, input.sheet, input.table)
    if (candidates.length > 1) return { selectionRequired: true, fileId: input.fileId, candidates, message: '识别出多张需求表，请用户选择后使用精确 sheet 和 table 再次读取；当前草稿未改变。' }
    const document = { ...extractRequirements(index, meta, input.sheet, input.table), rulesDigest: RULES }
    const state = await this.owner.store.update(input.sessionId, { ...input, requireRevision: true }, state => {
      const req = state.requirements
      if (req.document?.source.fileId === input.fileId && req.document?.source.indexSha256 === meta.indexSha256 && req.document?.sheet === document.sheet && req.document?.title.address === document.title.address && req.document?.rulesDigest === RULES) return
      state.requirements = { ...emptyRequirements(), revision: req.revision, document }
      invalidate(state)
    })
    return this.owner.decorate(state)
  }
  async update(input, origin = 'agent') {
    object(input, ['sessionId', 'revision', 'edits', 'supplements', 'boundary'])
    const state = await this.owner.store.update(input.sessionId, { ...input, requireRevision: true }, state => {
      const req = state.requirements
      if (!req.document) throw new McheError('请先读取当前会话的冷凝器需求表')
      const before = requirementDigest(req)
      if (input.edits !== undefined) {
        object(input.edits, req.document.records.map(record => record.id))
        for (const [id, value] of Object.entries(input.edits)) req.edits[id] = value === null ? null : adoptedEntry(value, origin)
      }
      if (input.supplements !== undefined) {
        object(input.supplements, BOUNDARY_KEYS.filter(key => !req.document.records.some(record => record.key === key)))
        for (const [key, value] of Object.entries(input.supplements)) {
          const entry = value === null ? null : adoptedEntry(value, origin)
          if (entry) req.supplements[key] = entry; else delete req.supplements[key]
        }
      }
      if (input.boundary !== undefined) {
        object(input.boundary, ['refrigerant', 'air', 'flow'])
        for (const [key, options] of Object.entries({ refrigerant: REFRIGERANT_MODES, air: AIR_MODES, flow: FLOW_MODES })) {
          if (!Object.hasOwn(options, input.boundary[key])) throw new McheError(`请选择明确的 ${key} Boundary 模式`)
        }
        req.boundary = { ...input.boundary }
      }
      if (requirementDigest(req) !== before) invalidate(state)
    })
    return this.owner.decorate(state)
  }
  async get(input) { object(input, ['sessionId']); return this.owner.get(input) }
  async confirm(input, origin) {
    if (origin !== 'user') throw new McheError('客户需求只能由用户在页面核对差异后确认', 403)
    object(input, ['sessionId', 'revision', 'reviewId'])
    const state = await this.owner.store.update(input.sessionId, { ...input, requireRevision: true }, async state => {
      const req = state.requirements, review = this.view(state)
      if (!req.document || !req.boundary) throw new McheError('请先读取需求并选择一套 Boundary')
      if (review.mappingStale) throw conflict('映射规则已更新，请重新读取原表后核对')
      if (review.assessment.confirmationBlockers.length) throw new McheError(review.assessment.confirmationBlockers.map(b => b.message).join('；'))
      if (input.reviewId !== review.reviewId || review.reviewed) throw conflict('需求核对已过期或已确认，请刷新差异')
      const { meta } = await this.load(req.document.source.fileId, input.sessionId)
      if (meta.sha256 !== req.document.source.sha256 || meta.indexSha256 !== req.document.source.indexSha256) throw conflict('需求原件或索引已变化，请重新读取')
      const now = new Date().toISOString(), id = randomUUID(), snapshotDigest = requirementDigest(req)
      const snapshot = { id, digest: snapshotDigest, rulesDigest: RULES, confirmedAt: now, confirmedBy: 'user',
        revision: req.revision, document: structuredClone(req.document), edits: structuredClone(req.edits), supplements: structuredClone(req.supplements),
        boundary: structuredClone(req.boundary), inputComplete: review.assessment.inputComplete, roles: review.assessment.roles, inputs: review.assessment.inputs,
        entries: structuredClone(review.assessment.entries), derived: structuredClone(review.assessment.derived),
        profileDraft: structuredClone(review.profileDraft), fieldIssues: structuredClone(review.assessment.fieldIssues) }
      req.confirmation = { id, digest: snapshotDigest, rulesDigest: RULES, revision: req.revision, confirmedAt: now, confirmedBy: 'user' }
      const calc = state.calculation
      calc.draft = calculationDraft(state, review.assessment)
      calc.boundary = { ...req.boundary, inputs: structuredClone(review.assessment.inputs) }
      calc.requirementsSnapshot = snapshot
      calc.revision++; calc.confirmation = null; calc.preparation = null; state.preparation = null
    })
    return this.owner.decorate(state)
  }
}
