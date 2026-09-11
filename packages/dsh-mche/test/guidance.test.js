import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fixture, select, value, prepared, repo } from './calculation-fixture.js'
import { ExcelService } from '../../dsh-excel-understanding/src/service.js'
import { parseWorkbook } from '../../dsh-excel-understanding/src/parser.js'
import { digest, inputDigest } from '../src/calculation-mapper.js'
import { REQUIREMENTS_RULES } from '../src/requirements-version.js'
import { recommendationContext } from '../src/recommendation-context.js'
import { installTools } from '../src/tools.js'
import { compactCase } from '../src/tool-output.js'

async function setup(t, selected = false) {
  const { service, root } = await fixture(t, { probe: async () => ({ ready: true }) }), sessionId = randomUUID()
  if (selected) await select(service, sessionId, ['A10', 'B04', 'R134a'])
  const excel = new ExcelService({ root: join(root, 'excel'), parse: parseWorkbook }); service.requirements.excel = excel
  const { file } = await excel.import({ sessionId, name: '客户资料.xls', bytes: await readFile(join(repo, '答复_/3-冷凝器客户输入.xls')) })
  const current = await service.get({ sessionId })
  const state = await service.requirementsRead({ sessionId, fileId: file.fileId, revision: current.revision })
  return { service, root, sessionId, state }
}
const allIssues = state => state.guidance.groups.flatMap(g => g.issues)

test('effective requirements supply references, not inferred selection constraints; explicit draft bounds filter and stale old basis', async t => {
  const { service, sessionId, state } = await setup(t)
  assert.equal(state.requirements.document.records.length, 26)
  assert.deepEqual(state.recommendationContext.constraints, [])
  assert.equal(state.recommendationContext.references.find(r => r.field === 'spaceLength').unit, 'mm')
  const browse = await service.recommend({ sessionId, limit: 100 })
  assert.equal(browse.candidates.total, 89); assert.equal(browse.candidates.stale, false)
  const old = browse.candidates.basisSummary
  const edited = await service.updateDraft({ sessionId, changes: { tubeWidth: value(16, 'mm') } })
  assert.equal(edited.candidates.stale, true); assert.deepEqual(edited.candidates.basisSummary, old)
  const filtered = await service.recommend({ sessionId, limit: 100 })
  assert.ok(filtered.candidates.items.every(c => c.geometry.widthMm === 16))
  assert.equal(filtered.candidates.basisSummary.constraints[0].basis, 'draft')
  const ref = state.requirements.document.records.find(r => r.key === 'spaceLength')
  const changed = await service.requirementsUpdate({ sessionId, revision: filtered.revision, edits: { [ref.id]: value(650, 'mm') } })
  assert.equal(changed.candidates.stale, true)
  assert.deepEqual(changed.candidates.basisSummary, filtered.candidates.basisSummary)
})

test('guidance uses selected mode or recommended coverage, not the union or unapplied PTM inputs', async t => {
  const { service, sessionId, state } = await setup(t)
  assert.ok(allIssues(state).some(i => i.field === 'boundary'))
  assert.equal(allIssues(state).some(i => i.field === 'refMassFlow'), false)
  assert.equal(state.guidance.boundary.recommended.boundary.refrigerant, 'ptsc')
  assert.deepEqual(state.guidance.boundary.recommended.missing, ['airPressure'])
  assert.equal(state.guidance.boundary.recommended.executionSupported, false)
  const ptm = await service.requirementsUpdate({ sessionId, revision: state.revision, boundary: { refrigerant: 'ptm', air: 'ptrh', flow: 'volume' } })
  assert.equal(allIssues(ptm).filter(i => i.field === 'refMassFlow').length, 1)
  assert.equal(allIssues(ptm).filter(i => i.field === 'airPressure').length, 1)
  assert.equal(allIssues(ptm).some(i => i.field === 'airWetBulb'), false)
  assert.ok(allIssues(ptm).some(i => i.field === 'airAngle'))
  assert.equal(ptm.requirements.assessment.entries.airHumidity.normalized, 55)
  assert.equal(ptm.requirements.assessment.entries.refSuperheat.normalized, 27.4)
})

test('reference confirmation requires the current digest and source, not revision alone', async t => {
  const { service, sessionId } = await setup(t)
  const raw = await service.store.view(sessionId), req = raw.requirements
  req.confirmation = { revision: req.revision, digest: digest({ rules: REQUIREMENTS_RULES,
    revision: req.revision, document: req.document, edits: req.edits, supplements: req.supplements, boundary: req.boundary }) }
  assert.ok(recommendationContext(raw).references.every(r => r.basis === 'confirmed'))
  req.sourceCheck = { valid: false }
  assert.ok(recommendationContext(raw).references.every(r => r.basis === 'draft'))
  delete req.sourceCheck
  req.confirmation.digest = 'old-rules-digest'
  assert.ok(recommendationContext(raw).references.every(r => r.basis === 'draft'))
  await service.store.update(sessionId, {}, s => { s.requirements.document.source.sha256 = 'changed-original' })
  for (const [method, key] of [['recommend', 'candidates'], ['finRecommend', 'finCandidates'], ['refrigerantRecommend', 'refrigerantCandidates']]) {
    const result = await service[method]({ sessionId })
    assert.equal(result[key].basisSummary.source.valid, false)
    assert.equal(result[key].stale, false)
    assert.ok(result[key].basisSummary.references.every(r => r.basis === 'draft'))
    assert.equal((await service.store.view(sessionId)).requirements.sourceCheck, undefined)
  }
})

test('topology owns counts/directions; viewing guidance does not write or alter input digest; only relevant parallel warnings', async t => {
  const { service } = await fixture(t), sessionId = 'topology'
  const before = await service.get({ sessionId })
  assert.ok(before.guidance.groups.find(g => g.id === 'data').issues.some(i => i.field === 'refPressure' && i.entry.view === 'conditions'))
  assert.equal(allIssues(before).filter(i => i.code === 'topology_missing').length, 1)
  const state = await service.calculationUpdateDraft({ sessionId, revision: 0, changes: {}, topology: { schemaVersion: 1,
    rows: [{ id: 'r1', passes: [{ id: 'p1', tubeCount: 30, direction: 'left' }] }], order: ['p1'], connection: 'series', source: '用户明确30根，左进右出' } })
  assert.equal(allIssues(state).some(i => ['tubeCount', 'refDirection', 'tubeLength', 'tubePitch'].includes(i.field) || i.code === 'topology_missing'), false)
  assert.equal(state.guidance.capabilities.some(c => c.id === 'parallel'), false)
  const raw = await service.store.view(sessionId), fingerprint = inputDigest(raw)
  const again = await service.get({ sessionId })
  assert.equal(again.revision, raw.revision); assert.equal(inputDigest(again), fingerprint)
  assert.deepEqual(await service.store.view(sessionId), raw)
  assert.equal(again.status.calculationReady, false)
})

test('A10/B04 original evidence and semantic choices remain distinct from engineering checks', async t => {
  const { service, sessionId, state } = await setup(t, true)
  assert.ok(allIssues(state).some(i => i.field === 'fin.review'))
  assert.ok(state.calculation.blockers.some(i => i.code === 'rectangular_area_conflict'))
  const fin = state.snapshots[state.selections.fin.snapshotId].fin
  const choices = state.guidance.semanticChoices
  assert.equal(choices.find(c => c.field === 'finHeightBasis').options[0].original.value, fin.geometry.heightPreBrazingMm)
  assert.equal(choices.find(c => c.field === 'louverLengthBasis').options[0].original.value, fin.geometry.louverLengthFullMm)
  assert.equal(choices.find(c => c.field === 'finPitchBasis').options.find(o => o.value === 'fpi').original, undefined)
  assert.match(allIssues(state).find(i => i.field === 'finUnitEvidence').reasons.join(), /目录原值和单位已保存/)
  const changed = await service.calculationUpdateDraft({ sessionId, revision: state.calculation.revision,
    changes: { finHeightBasis: value('heightPostBrazingMm'), louverLengthBasis: value('louverLengthOverallMm') } })
  assert.equal(changed.calculation.provenance.find(p => p.field === 'finHeight').original.value, fin.geometry.heightPostBrazingMm)
  assert.equal(changed.calculation.draft.finHeight, undefined)
  assert.equal(changed.guidance.stages.calculationSucceeded, false)
})

test('old records have no invented basis, refresh is read-only and fresh session is isolated', async t => {
  const { service, sessionId, root } = await setup(t)
  await service.recommend({ sessionId })
  await service.store.update(sessionId, {}, s => { delete s.candidates.basisSummary })
  const dir = join(root, sessionId), paths = await readdir(dir)
  const before = await Promise.all(paths.map(p => readFile(join(dir, p), 'utf8')))
  const state = await service.get({ sessionId })
  assert.equal(state.candidates.stale, true); assert.match(state.candidates.staleReason, /旧记录缺少依据摘要/)
  assert.equal(state.candidates.basisSummary, undefined)
  assert.deepEqual(await Promise.all(paths.map(p => readFile(join(dir, p), 'utf8'))), before)
  assert.deepEqual((await service.get({ sessionId: 'other' })).recommendationContext.constraints, [])
  assert.equal((await service.get({ sessionId: 'other' })).guidance.stages.dataRead, false)
})

test('full customer + parts stays within tool budget; pagination preserves actual basis and execution limits; business errors are failures', async t => {
  const { service, sessionId } = await setup(t, true), tools = new Map()
  installTools({ tools: { register: tool => tools.set(tool.name, tool) } }, service)
  const exec = { agent: { id: sessionId } }
  await service.store.update(sessionId, {}, s => { for (const p of s.proposals) p.reason = '用户明确指定，保留目录证据和待核对信息。'.repeat(14) })
  t.diagnostic(JSON.stringify(Object.fromEntries(Object.entries(compactCase(await service.get({ sessionId }))).map(([k, v]) => [k, Buffer.byteLength(JSON.stringify(v) ?? '')]))))
  for (const name of ['mche_case_get', 'mche_requirements_get', 'mche_calculation_profile_get']) {
    const raw = await tools.get(name).execute({}, exec), result = JSON.parse(raw)
    assert.notEqual(result.ok, false, `${name}: ${result.message}`); assert.ok(Buffer.byteLength(raw) <= 32000)
    assert.ok(result.guidance.capabilities.some(c => c.id === 'native_validation'))
  }
  for (const [name, key, expected] of [['tube_recommend', 'candidates', 89], ['fin_recommend', 'finCandidates', 164], ['refrigerant_recommend', 'refrigerantCandidates', 61]]) {
    let offset = 0, digest, seen = new Set()
    do {
      const raw = await tools.get(name).execute({ offset, limit: 100 }, exec), result = JSON.parse(raw), page = result[key]
      assert.notEqual(result.ok, false, `${name}: ${result.message}`); assert.ok(Buffer.byteLength(raw) <= 32000)
      assert.ok(page.items.length); assert.ok(page.basisSummary); digest ??= page.basisSummary.contextDigest
      assert.equal(page.basisSummary.contextDigest, digest)
      for (const item of page.items) { assert.ok(!seen.has(item.name)); seen.add(item.name) }
      assert.equal(result.guidance.boundary.recommended.executionSupported, false)
      offset = page.nextOffset
    } while (offset !== null)
    assert.equal(seen.size, expected)
  }
  const editor = JSON.parse(await tools.get('mche_calculation_open_editor').execute({}, exec))
  assert.notEqual(editor.ok, false, editor.message); assert.equal(editor.mche.openEditor, true)
  const failure = JSON.parse(await tools.get('mche_calculation_update_draft').execute({ changes: {}, revision: 999 }, exec))
  assert.equal(failure.ok, false)
})

test('guidance does not change ready flags or confirmation; historical successes never label current snapshot successful', async t => {
  const { service } = await fixture(t, { probe: async () => ({ ready: true }) })
  const state = await prepared(service)
  assert.equal(state.guidance.stages.mappingReady, true)
  assert.equal(state.guidance.stages.calculationReady, state.status.calculationReady)
  const raw = await service.store.view('case-a')
  assert.equal(raw.guidance, undefined); assert.equal(raw.recommendationContext, undefined)
  assert.equal(inputDigest(raw), inputDigest(state))
  assert.ok(compactCase(state).guidance)
})
