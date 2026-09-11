import { randomUUID } from 'node:crypto'
import { engineeringGuidance, boundaryCoverage } from './guidance.js'
import { recommendationContext, recommendationStatus } from './recommendation-context.js'
import { join } from 'node:path'
import { CalculationService } from './calculation-service.js'
import { RequirementsService } from './requirements-service.js'
import { fileURLToPath } from 'node:url'
import { CaseStore } from './store.js'
import { getTube, loadCatalog, searchCatalog } from './catalog.js'
import { CONSTRAINT_FIELDS, draftChanges, INPUT_FIELDS, missingInputs } from './inputs.js'
import { assessTube, recommendations } from './recommendation.js'
import { preparePackage, statusOf } from './preparation.js'
import { conflict, McheError, object, session, text } from './validation.js'
import { getFinRecord, loadFinCatalog, searchFinCatalog } from './fin-catalog.js'
import { assessFin, finRecommendations } from './fin-recommendation.js'
import { FIN_CONSTRAINT_FIELDS, FIN_INPUT_FIELDS } from './fin-fields.js'
import { REFRIGERANT_CONSTRAINT_FIELDS, REFRIGERANT_INPUT_FIELDS } from './refrigerant-fields.js'
import { loadRefrigerantCatalog, getRefrigerantRecord, searchRefrigerantCatalog } from './refrigerant-catalog.js'
import { recommendRefrigerant, proposeRefrigerant, confirmRefrigerant, recheckRefrigerant } from './refrigerant-selection.js'

export class McheService {
  constructor({ root, catalogPath, finCatalogPath = fileURLToPath(new URL('../../../data/catalogs/fins.json', import.meta.url)),
    refrigerantCatalogPath = fileURLToPath(new URL('../../../data/catalogs/refrigerants.json', import.meta.url)), calculation = {}, excel }) {
    this.store = new CaseStore(root); this.catalogPath = catalogPath; this.finCatalogPath = finCatalogPath
    this.refrigerantCatalogPath = refrigerantCatalogPath
    this.calculations = new CalculationService(this, { root: join(root, '_calculation-runs'), ...calculation })
    this.requirements = new RequirementsService(this, excel)
  }
  catalog() { return loadCatalog(this.catalogPath) }
  finCatalog() { return loadFinCatalog(this.finCatalogPath) }
  refrigerantCatalog() { return loadRefrigerantCatalog(this.refrigerantCatalogPath) }
  async refrigerant(input) {
    object(input, ['sessionId', 'name']); session(input.sessionId)
    return getRefrigerantRecord(await this.refrigerantCatalog(), input.name)
  }
  async refrigerantSearch(input) { session(input.sessionId); return searchRefrigerantCatalog(await this.refrigerantCatalog(), input) }
  refrigerantRecommend(input) { return recommendRefrigerant(this, input) }
  refrigerantPropose(input) { return proposeRefrigerant(this, input) }
  confirmRefrigerant(input) { return confirmRefrigerant(this, input) }
  async decorate(state) {
    state = await this.requirements.checkedState(state)
    const calculation = await this.calculations.view(state)
    const [catalog, fins, refrigerants] = await Promise.all([this.catalog(), this.finCatalog(), this.refrigerantCatalog()])
    const snapshot = state.snapshots[state.selections.tube?.snapshotId]
    const finSnapshot = state.snapshots[state.selections.fin?.snapshotId]
    const refrigerantSnapshot = state.snapshots[state.selections.refrigerant?.snapshotId]
    const context = recommendationContext(state)
    const requirements = this.requirements.view(state, refrigerants)
    requirements.recommendation.combination = boundaryCoverage(requirements.recommendation)
    const result = { ...state, recommendationContext: context,
      candidates: recommendationStatus(state.candidates, context, catalog.catalogDigest),
      finCandidates: recommendationStatus(state.finCandidates, context, fins.catalogDigest),
      refrigerantCandidates: recommendationStatus(state.refrigerantCandidates, context, refrigerants.catalogDigest),
      calculation, requirements, preparation: state.preparation && { ...state.preparation, calculationReady: Boolean(calculation.preparation?.calculationReady) }, fields: INPUT_FIELDS, status: { ...statusOf(state),
      dllMappingReady: Boolean(calculation.preparation?.native && !calculation.preparation.stale),
      calculationReady: Boolean(calculation.preparation?.calculationReady) }, missing: missingInputs(state),
      catalogChanged: Boolean(snapshot && snapshot.catalogDigest !== catalog.catalogDigest),
      finCatalogChanged: Boolean(finSnapshot && finSnapshot.catalogDigest !== fins.catalogDigest),
      refrigerantCatalogChanged: Boolean(refrigerantSnapshot && refrigerantSnapshot.catalogDigest !== refrigerants.catalogDigest),
      currentRefrigerantCatalogDigest: refrigerants.catalogDigest,
      currentFinCatalogDigest: fins.catalogDigest, currentCatalogDigest: catalog.catalogDigest, scope: 'tube-fin-refrigerant-logical' }
    return { ...result, guidance: engineeringGuidance(result) }
  }
  async get(input) {
    object(input, ['sessionId'])
    return this.decorate(await this.store.view(input.sessionId))
  }
  async tube(input) {
    object(input, ['sessionId', 'name']); session(input.sessionId)
    return getTube(await this.catalog(), input.name)
  }
  async search(input) { session(input.sessionId); return searchCatalog(await this.catalog(), input) }
  async fin(input) {
    object(input, ['sessionId', 'name']); session(input.sessionId)
    return getFinRecord(await this.finCatalog(), input.name)
  }
  async finSearch(input) { session(input.sessionId); return searchFinCatalog(await this.finCatalog(), input) }
  async updateDraft(input, origin = 'agent') {
    object(input, ['sessionId', 'changes', 'revision'])
    const changes = draftChanges(input.changes, origin)
    const state = await this.store.update(input.sessionId, input, (state) => applyDraft(state, changes))
    return this.decorate(state)
  }
  async confirmInputs(input) {
    object(input, ['sessionId', 'revision', 'reviewId', 'fields'])
    const state = await this.store.update(input.sessionId, { ...input, requireRevision: true }, (state) => {
      if (!state.inputReviewId || input.reviewId !== state.inputReviewId) throw conflict('输入核对已失效，请重新打开详情')
      if (!Array.isArray(input.fields) || !input.fields.length || input.fields.some((key) =>
        typeof key !== 'string' || !Object.hasOwn(state.draft, key) || Object.hasOwn(state.confirmed, key))) throw conflict('字段不存在或已经确认')
      const now = new Date().toISOString()
      for (const key of new Set(input.fields)) state.confirmed[key] = { ...state.draft[key], confirmedAt: now, confirmedBy: 'user' }
      state.preparation = null
    })
    return this.decorate(state)
  }
  async recommend(input) {
    object(input, ['sessionId', 'names', 'offset', 'limit'])
    const state = await this.store.update(input.sessionId, {}, async (state) => {
      state.candidates = recommendations(await this.catalog(), await this.requirements.checkedState(state), input)
    })
    return this.decorate(state)
  }
  async finRecommend(input) {
    object(input, ['sessionId', 'names', 'offset', 'limit'])
    const state = await this.store.update(input.sessionId, {}, async state => {
      state.finCandidates = finRecommendations(await this.finCatalog(), await this.requirements.checkedState(state), input)
    })
    return this.decorate(state)
  }
  async propose(input) {
    object(input, ['sessionId', 'name', 'reason', 'revision'])
    text(input.reason, 300)
    const state = await this.store.update(input.sessionId, input, async (state) => {
      const catalog = await this.catalog(), { tube } = getTube(catalog, input.name)
      staleProposals(state)
      state.proposals.push({ id: randomUUID(), component: 'tube', componentVersion: state.componentVersions.tube, sessionId: state.sessionId, name: tube.name,
        status: 'pending', inputVersion: state.inputVersion, catalogDigest: catalog.catalogDigest,
        reason: input.reason, assessment: assessTube(tube, state), createdAt: new Date().toISOString() })
    })
    return this.decorate(state)
  }
  async confirmTube(input) {
    object(input, ['sessionId', 'revision', 'proposalId'])
    const state = await this.store.update(input.sessionId, { ...input, requireRevision: true }, async (state) => {
      const proposal = state.proposals.find((item) => item.id === input.proposalId)
      if (!proposal || (proposal.component ?? 'tube') !== 'tube' || proposal.sessionId !== input.sessionId || proposal.status !== 'pending' ||
        (proposal.componentVersion ?? proposal.inputVersion) !== state.componentVersions.tube) throw conflict('建议已处理或失效，请重新建议型号')
      const catalog = await this.catalog()
      if (proposal.catalogDigest !== catalog.catalogDigest) throw conflict('目录已更新，请重新查询并建议型号')
      const record = getTube(catalog, proposal.name)
      const snapshot = { id: randomUUID(), ...record, createdAt: new Date().toISOString() }
      state.snapshots[snapshot.id] = snapshot
      proposal.status = 'confirmed'; proposal.confirmedAt = snapshot.createdAt
      state.selections.tube = { proposalId: proposal.id, snapshotId: snapshot.id, name: proposal.name,
        confirmed: true, confirmedAt: snapshot.createdAt, invalidReason: null }
      state.preparation = null
      recheckSelection(state)
    })
    return this.decorate(state)
  }
  async finPropose(input) {
    object(input, ['sessionId', 'name', 'reason', 'revision']); text(input.reason, 300)
    const state = await this.store.update(input.sessionId, input, async state => {
      const catalog = await this.finCatalog(), { fin } = getFinRecord(catalog, input.name)
      staleProposals(state, 'fin')
      state.proposals.push({ id: randomUUID(), component: 'fin', sessionId: state.sessionId, name: fin.name,
        status: 'pending', inputVersion: state.inputVersion, componentVersion: state.componentVersions.fin,
        catalogDigest: catalog.catalogDigest, reason: input.reason, assessment: assessFin(fin, state), createdAt: new Date().toISOString() })
    })
    return this.decorate(state)
  }
  async confirmFin(input) {
    object(input, ['sessionId', 'revision', 'proposalId'])
    const state = await this.store.update(input.sessionId, { ...input, requireRevision: true }, async state => {
      const proposal = state.proposals.find(item => item.id === input.proposalId)
      if (!proposal || proposal.component !== 'fin' || proposal.sessionId !== input.sessionId || proposal.status !== 'pending' ||
          proposal.componentVersion !== state.componentVersions.fin) throw conflict('翅片建议已处理或失效，请重新建议型号')
      const catalog = await this.finCatalog()
      if (proposal.catalogDigest !== catalog.catalogDigest) throw conflict('翅片目录已更新，请重新查询并建议型号')
      const snapshot = { id: randomUUID(), ...getFinRecord(catalog, proposal.name), createdAt: new Date().toISOString() }
      state.snapshots[snapshot.id] = snapshot
      proposal.status = 'confirmed'; proposal.confirmedAt = snapshot.createdAt
      state.selections.fin = { name: proposal.name, code: snapshot.fin.code, section: snapshot.fin.section,
        proposalId: proposal.id, snapshotId: snapshot.id, confirmed: true, confirmedAt: snapshot.createdAt, invalidReason: null }
      state.preparation = null
      recheckFinSelection(state)
    })
    return this.decorate(state)
  }
  async prepare(input) {
    object(input, ['sessionId'])
    const runtime = await this.calculations.process.probe()
    return this.decorate(await this.store.update(input.sessionId, {}, async (state) => {
      state.preparation = preparePackage(state)
      await this.calculations.prepareState(state, runtime)
      state.preparation.calculationReady = state.calculation.preparation.calculationReady
    }))
  }
  calculationProfile(input) { return this.calculations.profile(input) }
  requirementsFiles(input) { return this.requirements.files(input) }
  requirementsRead(input) { return this.requirements.read(input) }
  requirementsGet(input) { return this.requirements.get(input) }
  requirementsUpdate(input, origin) { return this.requirements.update(input, origin) }
  requirementsRecommend(input) { return this.requirements.get(input) }
  requirementsConfirm(input, origin) { return this.requirements.confirm(input, origin) }
  calculationUpdateDraft(input, origin) { return this.calculations.update(input, origin) }
  calculationConfirm(input, origin) { return this.calculations.confirm(input, origin) }
  calculate(input, origin) { return this.calculations.calculate(input, origin) }
  calculationGet(input, origin) { return this.calculations.get(input, origin) }
  calculationCancel(input) { return this.calculations.cancel(input) }
  close() { return this.calculations.runs.close() }
}
function staleProposals(state, component = 'tube') {
  for (const proposal of state.proposals) if (proposal.status === 'pending' && (proposal.component ?? 'tube') === component) proposal.status = 'stale'
}
function applyDraft(state, changes) {
  const changed = Object.keys(changes).filter((key) => JSON.stringify(state.draft[key] ?? null) !== JSON.stringify(changes[key]))
  if (!changed.length) return
  for (const key of changed) {
    if (changes[key] === null) delete state.draft[key]
    else state.draft[key] = changes[key]
    delete state.confirmed[key]
  }
  state.inputVersion++; state.inputReviewId = randomUUID()
  if (changed.some(key => !Object.hasOwn(FIN_INPUT_FIELDS, key) && !Object.hasOwn(REFRIGERANT_INPUT_FIELDS, key))) {
    state.componentVersions.tube++; staleProposals(state)
    if (state.candidates) state.candidates.stale = true
  }
  if (changed.some(key => FIN_CONSTRAINT_FIELDS.includes(key))) {
    state.componentVersions.fin++; staleProposals(state, 'fin')
    if (state.finCandidates) state.finCandidates.stale = true
    recheckFinSelection(state, changed)
  }
  state.preparation = null
  if (changed.some(key => REFRIGERANT_CONSTRAINT_FIELDS.includes(key))) {
    state.componentVersions.refrigerant++; staleProposals(state, 'refrigerant')
    if (state.refrigerantCandidates) state.refrigerantCandidates.stale = true
    recheckRefrigerant(state, changed)
  }
  if (changed.some((key) => CONSTRAINT_FIELDS.includes(key))) recheckSelection(state, changed)
}
function recheckFinSelection(state, changed = []) {
  const selected = state.selections.fin
  if (!selected?.confirmed) return
  const assessment = assessFin(state.snapshots[selected.snapshotId].fin, state)
  const affected = [...assessment.unmet, ...assessment.unknown.filter(item => changed.includes(item.field))]
  if (affected.length) {
    selected.confirmed = false
    selected.invalidReason = `翅片不满足或无法核实变更条件：${affected.map(item => INPUT_FIELDS[item.field].label).join('、')}；请重新选择并确认`
  }
}
function recheckSelection(state, changed = []) {
  const selected = state.selections.tube
  if (!selected?.confirmed) return
  const assessment = assessTube(state.snapshots[selected.snapshotId].tube, state)
  const affected = [...assessment.unmet, ...assessment.unknown.filter((item) => changed.includes(item.field))]
  if (affected.length) {
    selected.confirmed = false
    selected.invalidReason = `型号不满足或无法核实变更条件：${affected.map((item) => INPUT_FIELDS[item.field].label).join('、')}；请重新选择并确认`
  }
}
