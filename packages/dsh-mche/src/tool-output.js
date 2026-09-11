import { McheError } from './validation.js'

const MAX_BYTES = 32000
export function compactGuidance(guidance) {
  if (!guidance) return guidance
  const { details, ...value } = guidance
  return { ...value, groups: value.groups.map(g => ({ ...g, issues: g.issues.map(i => ({ field: i.field,
    reasons: i.reasons, sources: i.sources.map(s => s.slice(0, 100)), impact: i.impact, entry: i.entry })) })),
    semanticChoices: value.semanticChoices?.map(c => ({ ...c, options: c.options.map(o => ({ ...o,
      ...(o.original ? { original: { value: o.original.value, unit: o.original.unit, cell: o.original.evidence?.cell,
        display: o.original.evidence?.display } } : {}) })) })) }
}
export const compactRecommendationContext = context => context && { ...context, references: context.references.map(({ evidence, ...r }) => ({ ...r,
  source: evidence ? `${evidence.sheet}!${evidence.address}` : r.source })) }
const compactBasis = basis => basis && { ...basis, references: basis.references.map(r => ({ field: r.field, value: r.value,
  unit: r.unit, source: r.evidence ? `${r.evidence.sheet}!${r.evidence.address}` : r.source, role: r.role, basis: r.basis })) }
const briefEntry = e => e && { value: e.value, unit: e.unit, normalized: e.normalized, normalizedUnit: e.normalizedUnit,
  source: e.source?.slice(0, 160), recordId: e.recordId, evidence: e.evidence && { sheet: e.evidence.sheet, address: e.evidence.address },
  conversion: e.conversion, derived: e.derived }
function compactProfile(profile) {
  if (!profile) return null
  const adopted = e => e && { value: e.value, unit: e.unit, normalized: e.normalized, normalizedUnit: e.normalizedUnit,
    source: e.recordId ? e.recordId : e.source?.slice(0, 100), conversion: e.conversion }
  return { mappingId: profile.mappingId, mappingVersion: profile.mappingVersion,
    sections: profile.sections.map(section => ({ id: section.id, label: section.label, fields: section.fields.map(field => ({
    key: field.key, target: field.target, entry: adopted(field.entry), role: field.role,
    ...(field.issues.length ? { issues: field.issues } : {}),
    ...(field.unitBasis.length ? { unitBasis: field.unitBasis.map(b => ({ selectedUnit: b.original.selectedUnit,
      unitCell: b.original.unitCell, selection: b.original.selection?.map(c => c.address),
      ...(b.edited ? { edited: true } : {}),
      ...(b.original.numberFormat ? { percentRaw: b.original.numberFormat.raw, format: b.original.numberFormat.format } : {}),
      ...(b.original.equivalentTemperatureDifference ? { equivalentTemperatureDifference: true } : {}) })) } : {}),
    ...(field.derivation ? { derivation: { formula: field.derivation.formula, calculated: field.derivation.calculated,
      ...(field.derivation.explicit ? { explicit: adopted(field.derivation.explicit), conflict: field.derivation.conflict } : {}),
      sources: field.derivation.sources.map(s => ({ field: s.field, entry: s.entry && {
        value: s.entry.value, unit: s.entry.unit, normalized: s.entry.normalized, normalizedUnit: s.entry.normalizedUnit,
        evidence: s.entry.evidence && { sheet: s.entry.evidence.sheet, address: s.entry.evidence.address },
      } })) } } : {}),
    ...(field.signConvention ? { signConvention: field.signConvention } : {}),
  })) })) }
}
function compactCalculation(calculation, includeProfile = true) {
  if (!calculation) return calculation
  const prep = calculation.preparation
  return { revision: calculation.revision, profile: calculation.profile, confirmed: calculation.confirmed,
    topology: calculation.topology, topologyLayout: calculation.topologyLayout, topologyStored: calculation.topologyStored,
    ...(includeProfile ? { profileDraft: compactProfile(calculation.profileDraft) } : {}),
    boundary: calculation.boundary && { refrigerant: calculation.boundary.refrigerant, air: calculation.boundary.air, flow: calculation.boundary.flow },
    requirementsSnapshot: calculation.requirementsSnapshot && { id: calculation.requirementsSnapshot.id, digest: calculation.requirementsSnapshot.digest },
    draft: Object.fromEntries(Object.entries(calculation.draft ?? {}).map(([k,v]) => [k,{ value:v.value,unit:v.unit,source:v.source.slice(0,160) }])),
    blockers: calculation.blockers, warnings: calculation.warnings,
    preparation: prep && { id:prep.id,stale:prep.stale,calculationReady:prep.calculationReady,blockers:prep.blockers,
      profileId:prep.profileId,fingerprint:prep.fingerprint,runtime:{ready:prep.runtime?.ready,error:prep.runtime?.error} },
    runs: calculation.runs?.slice(0,5), runCount:calculation.runCount }
}
export function compactRequirements(req, revision) {
  if (!req) return req
  if (!req.document) return { revision: req.revision, recordCount: 0, reviewed: false }
  return { revision: req.revision, reviewed: req.reviewed, boundary: req.boundary, source: req.document?.source,
    profileDraft: compactProfile(req.profileDraft), refrigerantSuggestion: req.refrigerantSuggestion, mappingStale: req.mappingStale, sourceCheck: req.sourceCheck,
    recordCount: req.document?.records.length ?? 0, inputComplete: req.assessment?.inputComplete, executionSupported: req.assessment?.executionSupported,
    executionMessage: req.assessment?.executionMessage, missing: req.assessment?.missing,
    recommendation: { proposed: req.recommendation.proposed, basis: req.recommendation.basis, combination: req.recommendation.combination,
      ...Object.fromEntries(['refrigerant', 'air', 'flow'].map(key => [key, req.recommendation[key].map(m => ({ id: m.id, missing: m.missing }))])) },
    records: req.assessment?.rows.map(r => ({ id: r.id, key: r.key, raw: r.raw,
      ...(r.display !== String(r.raw) ? { display: r.display } : {}),
      ...(r.key.startsWith('unmapped:') ? { originalName: r.originalName } : {}),
      ...(r.edited ? { adopted: r.current && { value: r.current.value, unit: r.current.unit, source: r.current.source.slice(0, 100) } }
        : r.group !== 'main' && r.current?.unit ? { normalized: r.current.normalized, unit: r.current.normalizedUnit } : {}),
      ...(r.group !== 'main' ? { role: r.role } : {}),
      ...(r.currentIssues.length ? { issues: r.currentIssues } : {}) })),
    notes: ['所有原文与完整单位/派生证据在右侧需求页保留；SH后端重算，其他DLL模式尚未接入。',
      ...(revision === undefined ? [] : [`后续写操作使用本次返回的顶层方案 revision=${revision}（不是读取前的旧版本或需求子版本）。`]),
      `推荐模式按后端定义解释：${['refrigerant', 'air', 'flow'].map(key => {
        const id = req.recommendation.proposed[key], mode = req.modes[key][id]
        return `${id}=${mode.label}，字段：${mode.fields.join('、')}`
      }).join('；')}。`,
      `推荐组合输入缺项：${[...new Set(['refrigerant', 'air', 'flow'].flatMap(key =>
        req.recommendation[key].find(mode => mode.id === req.recommendation.proposed[key]).missing))].map(key => req.fields[key].label).join('、') || '无'}。只按所述模式列缺项，不把其他备选模式未填字段都列为必需。模式未选择及工程执行准备另行说明。`,
      ...req.assessment.notes,
      '回复简述读取结果、推荐、真正缺项与客户需求核对入口，完整资料在 Profile，无需重复长表。测试条件另列，不能与主工况混称或仅因温度不同要求二选一。',
      '需要核对风量时只问“请核对原表风量及单位是否正确”；没有额外依据不得评价偏大/偏小，不给替代数字、示例值或放大倍数。已确定的 RH 换算不再单独确认。不声称物性或工况自洽已验证，不主动追加整理参数表卡片。'] }
}
export function compactCase(state) {
  const { snapshots, proposals, fields, missing, guidance, recommendationContext, ...result } = state
  if (!snapshots) return state
  const brief = snapshot => {
    if (!snapshot) return null
    const record = snapshot.refrigerant ?? snapshot.fin ?? snapshot.tube
    return { id: snapshot.id, catalogId: snapshot.catalogId, catalogDigest: snapshot.catalogDigest,
      name: record.name, sequence: record.sequence, category: record.category, concentrationPercent: record.concentrationPercent,
      concentrationBasis: record.concentrationBasis, section: record.section, geometry: record.geometry, sourceRange: record.sourceRange,
      review: record.review, source: { path: snapshot.source.path, sha256: snapshot.source.sha256, sheet: snapshot.source.sheet } }
  }
  const requirements = compactRequirements(state.requirements, state.revision)
  // The full requirements tools retain source records and narrative proofs. A
  // case/selection response needs the same values, not repeated full source text.
  if (requirements) { delete requirements.records; delete requirements.notes }
  return { ...result, missing, missingScope: 'legacy-logical-only', guidance: compactGuidance(guidance), recommendationContext: compactRecommendationContext(recommendationContext),
    calculation: compactCalculation(state.calculation, !state.requirements?.document), requirements, proposals: ['tube', 'fin', 'refrigerant'].map(component => proposals.findLast(p => (p.component ?? 'tube') === component)).filter(Boolean).map(p => ({ id: p.id, component: p.component ?? 'tube', name: p.name, status: p.status })),
    selectedSnapshot: brief(snapshots[state.selections.tube?.snapshotId]), selectedFinSnapshot: brief(snapshots[state.selections.fin?.snapshotId]),
    selectedRefrigerantSnapshot: brief(snapshots[state.selections.refrigerant?.snapshotId]) }
}
function relevantResult(state, method) {
  if (method === 'calculationProfile') {
    return { ...compactCalculation(state), fields: state.fields, guidance: compactGuidance(state.guidance), recommendationContext: compactRecommendationContext(state.recommendationContext),
      runtime:{ready:state.runtime.ready,error:state.runtime.error,bits:state.runtime.bits} }
  }
  if (['requirementsRead', 'requirementsGet', 'requirementsUpdate', 'requirementsRecommend'].includes(method) && state.requirements) return {
    sessionId: state.sessionId, revision: state.revision, guidance: compactGuidance(state.guidance), recommendationContext: compactRecommendationContext(state.recommendationContext),
    requirements: compactRequirements(state.requirements, state.revision) }
  if (!state.snapshots) return structuredClone(state)
  const { candidates, finCandidates, refrigerantCandidates, preparation, ...result } = compactCase(state)
  if (['propose', 'finPropose', 'refrigerantPropose'].includes(method)) result.proposals = [state.proposals.at(-1)]
  if (['recommend', 'finRecommend', 'refrigerantRecommend'].includes(method)) {
    if (result.requirements) delete result.requirements.profileDraft
    // Keep the shared current issues; raw mapper diagnostics remain in the
    // Profile tool and page. Candidate pages need room for their saved evidence.
    if (result.calculation) { delete result.calculation.blockers; delete result.calculation.warnings }
    delete result.selectedSnapshot; delete result.selectedFinSnapshot; delete result.selectedRefrigerantSnapshot
    delete result.guidance.semanticChoices
  }
  const candidateView = (page, full) => page && (full ? { ...page, basisSummary: compactBasis(page.basisSummary) }
    : { id: page.id, basis: page.basis, stale: page.stale, staleReason: page.staleReason, basisDigest: page.basisSummary?.contextDigest })
  return { ...result,
    candidates: candidateView(candidates, method === 'recommend'),
    finCandidates: candidateView(finCandidates, method === 'finRecommend'),
    refrigerantCandidates: candidateView(refrigerantCandidates, method === 'refrigerantRecommend'),
    preparation: preparation && { id: preparation.id, status: preparation.status, blockers: preparation.blockers, scope:preparation.scope, calculationReady:preparation.calculationReady },
  }
}
export function toolOutput({ result, method, args, mche }) {
  const value = structuredClone({ ...relevantResult(result, method), mche })
  const page = method === 'recommend' ? value.candidates : method === 'finRecommend' ? value.finCandidates : method === 'refrigerantRecommend' ? value.refrigerantCandidates : ['search', 'finSearch', 'refrigerantSearch'].includes(method) ? value : null
  let encoded = JSON.stringify(value)
  while (Buffer.byteLength(encoded) > MAX_BYTES && method === 'calculationGet' && value.runs?.length > 1) {
    value.runs.pop(); value.nextOffset = (args.offset ?? 0) + value.runs.length; value.responsePaged = true
    encoded = JSON.stringify(value)
  }
  while (Buffer.byteLength(encoded) > MAX_BYTES && page?.items.length > 1) {
    page.items.pop(); page.nextOffset = (args.offset ?? 0) + page.items.length
    page.responsePaged = true
    encoded = JSON.stringify(value)
  }
  if (Buffer.byteLength(encoded) > MAX_BYTES) throw new McheError('单项响应超过 32 KB，请缩短工况原文或来源说明后重试；数据已保留在方案详情')
  return encoded
}
