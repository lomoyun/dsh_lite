import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseWorkbook } from '../../dsh-excel-understanding/src/parser.js'
import { ExcelService } from '../../dsh-excel-understanding/src/service.js'
import { extractRequirements, requirementTables } from '../src/requirements-parser.js'
import { boundaryAssessment, emptyRequirements } from '../src/requirements-boundary.js'
import { installTools } from '../src/tools.js'
import { fixture, prepared, repo } from './calculation-fixture.js'

const name = '3-冷凝器客户输入.xls', bytes = await readFile(join(repo, '答复_', name))
const indexOf = () => parseWorkbook({ bytes, name })
const meta = { fileId: randomUUID(), sha256: 'test-file', indexSha256: 'test-index', name }
const reqOf = index => ({ ...emptyRequirements(), document: extractRequirements(index ?? indexOf(), meta) })
const entry = (value, unit = '') => ({ value, unit, source: '自动化验收输入，非工程确认' })
const set = (sheet, address, raw, format = 'General') => sheet.cells[address] = { address, raw, display: String(raw), format }
const by = (req, key) => req.document.records.find(r => r.key === key)
const approx = (actual, expected) => assert.ok(Math.abs(actual-expected) < Math.max(1e-10, Math.abs(expected)*1e-12), `${actual} != ${expected}`)
const ptm = { refrigerant: 'ptm', air: 'ptrh', flow: 'volume' }

test('full sample Profile retains 26 records and independently derives SH with both normalized source coordinates', () => {
  const req = reqOf(), a = boundaryAssessment(req)
  assert.equal(req.document.records.length, 26)
  assert.equal(a.entries.refSuperheat.value, 27.4); assert.equal(a.entries.refSuperheat.unit, 'K')
  assert.deepEqual(a.derived[0].sources.map(s => s.entry.evidence.address), ['D6', 'D8'])
  assert.match(a.derived[0].formula, /refTemperature\[K\] - refSatTemperature\[K\]/)
  assert.equal(a.entries.airHumidity.normalized, 55); assert.equal(a.entries.refSubcooling.normalized, 0)
  assert.equal(a.entries.airVolumeFlow.value, 4); assert.equal(by(req, 'airVolumeFlow').raw, '4 m³/h')
  assert.equal(by(req, 'refSubcooling').unitBasis.selectedUnit, '°C')
  assert.equal(by(req, 'refSubcooling').unitBasis.equivalentTemperatureDifference, true)
  assert.equal(by(req, 'refTemperature').unitBasis.inline.text, '°C')
  assert.equal(by(req, 'airHumidity').unitBasis.numberFormat.raw, 0.55)
  assert.deepEqual(a.profileDraft.sections.map(s => s.id), ['refrigerant', 'inlet', 'outlet', 'air'])
  assert.ok(a.profileDraft.sections[1].fields.some(f => f.target === 'Quality' && f.entry === null))
})

test('selected left imperial column converts Fahrenheit, psia, lbm/h and actual CFM with retained selection evidence', () => {
  const index = indexOf(), sheet = index.sheets[0]
  set(sheet, 'B3', '■'); set(sheet, 'C3', '□')
  for (const [address, raw] of [['D6', 180.32], ['D7', 300], ['D8', 131], ['D10', 900], ['D11', 9], ['D13', 89.6], ['D16', 100]]) set(sheet, address, raw)
  const req = reqOf(index), a = boundaryAssessment(req)
  approx(a.entries.refTemperature.normalized, 355.55); approx(a.entries.refPressure.normalized, 2068427.1879504)
  approx(a.entries.refMassFlow.normalized, 0.1133980925); approx(a.entries.airVolumeFlow.normalized, 0.04719474432)
  approx(a.entries.refSubcooling.normalized, 5); approx(a.entries.refSuperheat.normalized, 27.4)
  assert.equal(by(req, 'refPressure').unitBasis.selectedRaw, 'psia')
  assert.equal(by(req, 'refMassFlow').unitBasis.unitCell, 'B10')
  assert.equal(by(req, 'airVolumeFlow').unitBasis.selectedUnit, 'ACFM')
})

test('unit choice never falls back to inline or percent when ambiguous, absent or conflicting', () => {
  for (const mark of ['■', '□']) {
    const index = indexOf(), s = index.sheets[0]; set(s, 'B3', mark); set(s, 'C3', mark)
    const req = reqOf(index)
    for (const key of ['refTemperature', 'airHumidity', 'refSubcooling', 'spaceLength']) assert.equal(by(req, key).adopted.normalized, null)
    assert.equal(by(req, 'refTemperature').raw, '82,4 °C')
  }
  for (const mutate of [s => { delete s.cells.C6 }, s => set(s, 'C6', 'K'), s => set(s, 'A3', 'Thermal Requirements'), s => set(s, 'C3', '☑')]) {
    const index = indexOf(); mutate(index.sheets[0]); const r = by(reqOf(index), 'refTemperature')
    assert.equal(r.adopted.normalized, null); assert.ok(r.issues.length)
  }
  const index = indexOf(); set(index.sheets[0], 'B2', '■') // unrelated earlier mark
  assert.equal(by(reqOf(index), 'spaceLength').adopted.normalized, 600)
})

test('Quality label, percent format, fraction and duplicate rows preserve evidence without merging', () => {
  const index = indexOf(), s = index.sheets[0]
  set(s, 'A10', 'Quality'); set(s, 'B10', '%'); set(s, 'C10', '%'); set(s, 'D10', 0.35, '0%'); s.cells.D10.display = '35%'
  let req = reqOf(index); approx(by(req, 'refQuality').adopted.normalized, 0.35)
  set(s, 'B10', '--'); set(s, 'C10', '--'); set(s, 'D10', 0)
  req = reqOf(index); assert.equal(by(req, 'refQuality').adopted.normalized, 0)
  set(s, 'A53', 'Entering refrigerant temperature'); set(s, 'B53', 'oF'); set(s, 'C53', 'oC'); set(s, 'D53', 90)
  req = reqOf(index); assert.equal(req.document.records.filter(r => r.key === 'refTemperature').length, 2)
  let a = boundaryAssessment(req); assert.equal(a.entries.refTemperature.normalized, null); assert.equal(a.entries.refSuperheat.normalized, null)
  req.edits['refTemperature:D53'] = null
  a = boundaryAssessment(req); assert.equal(a.entries.refSuperheat.normalized, 27.4)
})

test('SH recomputes after either source edit/clear, rejects negative/invalid sources and compares explicit SH', () => {
  const req = reqOf()
  req.edits['refTemperature:D6'] = entry(85, '°C')
  assert.equal(boundaryAssessment(req).entries.refSuperheat.normalized, 30)
  req.edits['refSatTemperature:D8'] = entry(60, '°C')
  assert.equal(boundaryAssessment(req).entries.refSuperheat.normalized, 25)
  req.edits['refTemperature:D6'] = entry(358.15, 'K')
  assert.equal(boundaryAssessment(req).entries.refSuperheat.normalized, 25)
  for (const invalid of [null, entry('?', '°C'), entry(0, '°C')]) {
    req.edits['refTemperature:D6'] = invalid
    const a = boundaryAssessment(req); assert.equal(a.entries.refSuperheat.normalized, null); assert.equal(a.derived[0].calculated, null)
  }
  req.edits = {}; req.supplements.refSuperheat = entry(5, 'K')
  let a = boundaryAssessment(req)
  assert.equal(a.entries.refSuperheat.value, 5); assert.equal(a.entries.refSuperheat.normalized, null)
  assert.equal(a.derived[0].explicit.normalized, 5); assert.equal(a.derived[0].calculated, 27.4); assert.equal(a.confirmationBlockers.length, 1)
  req.supplements.refSuperheat = entry(49.32, '°F')
  a = boundaryAssessment(req); approx(a.entries.refSuperheat.normalized, 27.4); assert.equal(a.confirmationBlockers.length, 0)
  delete req.supplements.refSuperheat
  assert.equal(boundaryAssessment(req).entries.refSuperheat.derived, true)
})

test('explicit SH in Excel retains its original row while derived SH stays a separate checked item', () => {
  const index = indexOf(), s = index.sheets[0]
  set(s, 'A10', 'SH(+)'); set(s, 'B10', 'oF'); set(s, 'C10', 'oC'); set(s, 'D10', '10 K')
  const req = reqOf(index), a = boundaryAssessment(req)
  assert.equal(req.document.records.length, 27); assert.equal(by(req, 'refSuperheat').raw, '10 K')
  assert.equal(a.derived[0].explicit.value, 10); assert.equal(a.derived[0].calculated, 27.4)
  assert.equal(a.entries.refSuperheat.normalized, null); assert.equal(a.confirmationBlockers.length, 1)
  req.edits['refSuperheat:D10'] = null
  assert.equal(boundaryAssessment(req).entries.refSuperheat.normalized, 27.4)
  assert.equal(req.document.records.length, 27)
})

test('literal percent format and floating roundoff at equal C/F source temperatures do not fabricate values', () => {
  for (const format of ['0.00"%"', '0.00\\%']) {
    const index = indexOf(); set(index.sheets[0], 'D14', 0.55, format)
    assert.equal(by(reqOf(index), 'airHumidity').adopted.normalized, 0.55)
  }
  const req = reqOf()
  req.edits['refSatTemperature:D8'] = entry(180.32, '°F')
  assert.equal(boundaryAssessment(req).entries.refSuperheat.normalized, 0)
  req.edits['refSatTemperature:D8'] = entry(82.4000001, '°C')
  assert.equal(boundaryAssessment(req).entries.refSuperheat.normalized, null)
})

async function setup(t, { prepare = false, parse = parseWorkbook } = {}) {
  const { service, root } = await fixture(t, { probe: async () => ({ ready: true }) }), sessionId = randomUUID()
  const excel = new ExcelService({ root: join(root, 'excel'), parse }); service.requirements.excel = excel
  const original = prepare ? await prepared(service, sessionId) : await service.get({ sessionId })
  const { file } = await excel.import({ bytes, name, sessionId })
  const read = args => service.requirementsRead({ sessionId, fileId: file.fileId, revision: original.revision, ...args })
  const update = (state, args) => service.requirementsUpdate({ sessionId, revision: state.revision, ...args }, 'user')
  const confirm = state => service.requirementsConfirm({ sessionId, revision: state.revision, reviewId: state.requirements.reviewId }, 'user')
  return { service, root, sessionId, excel, file, read, update, confirm }
}

test('multiple hidden sheets or stacked forms return choices without modifying case; exact choice is used', async t => {
  const index = indexOf(); index.sheets.push({ ...structuredClone(index.sheets[0]), name: 'Hidden second', hidden: 1 })
  const f = await setup(t, { parse: () => index }), choice = await f.read()
  assert.equal(choice.selectionRequired, true); assert.equal(choice.candidates.length, 2)
  assert.equal((await f.service.get({ sessionId: f.sessionId })).requirements.document, null)
  const selected = await f.read({ sheet: choice.candidates[1].sheet, table: choice.candidates[1].table })
  assert.equal(selected.requirements.document.sheet, 'Hidden second'); assert.equal(selected.requirements.document.records.length, 26)
  const stacked = indexOf(), s = stacked.sheets[0]
  const shift = a => a.replace(/\d+$/, row => Number(row)+80)
  for (const cell of Object.values(s.cells)) s.cells[shift(cell.address)] = { ...cell, address: shift(cell.address) }
  s.merges.push(...s.merges.map(r => r.split(':').map(shift).join(':')))
  assert.equal(requirementTables(stacked).length, 2)
  assert.equal(extractRequirements(stacked, meta, s.name, 'A81').records.length, 26)
})

test('confirmation snapshots retain whole Profile; SH conflict blocks review; sources and rules invalidate preparation', async t => {
  const f = await setup(t, { prepare: true }), { service, sessionId } = f
  let state = await f.read()
  assert.equal(state.requirements.refrigerantSuggestion.requested, 'R454C')
  assert.equal(state.requirements.refrigerantSuggestion.different, true)
  state = await f.update(state, { boundary: ptm, supplements: { refMassFlow: entry(900, 'kg/h'), airPressure: entry(101325, 'Pa') }, edits: { 'refrigerant:D5': entry('WATER') } })
  assert.equal(state.requirements.refrigerantSuggestion.exactMatch.name, 'WATER')
  state = await f.confirm(state)
  const snapshot = state.calculation.requirementsSnapshot
  assert.equal(snapshot.entries.refSuperheat.normalized, 27.4); assert.equal(snapshot.profileDraft.sections.length, 4)
  assert.equal(snapshot.derived[0].sources[0].entry.evidence.address, 'D6')
  assert.deepEqual(snapshot.profileDraft, (await service.calculationProfile({ sessionId })).profileDraft)
  state = await service.calculationConfirm({ sessionId, revision: state.calculation.revision, reviewId: state.calculation.reviewId }, 'user')
  state = await service.prepare({ sessionId }); const oldPrep = state.calculation.preparation
  assert.equal(oldPrep.calculationReady, true)
  state = await f.update(state, { edits: { 'refTemperature:D6': entry(84, '°C') } })
  assert.equal(state.requirements.assessment.entries.refSuperheat.normalized, 29)
  assert.equal(state.requirements.reviewed, false); assert.equal(state.calculation.preparation, null)
  assert.equal(snapshot.entries.refSuperheat.normalized, 27.4) // immutable historical result
  state = await f.update(state, { supplements: { refSuperheat: entry(2, 'K') } })
  await assert.rejects(f.confirm(state), /冲突/)
  state = await f.update(state, { supplements: { refSuperheat: null } }); state = await f.confirm(state)
  await writeFile(join(f.excel.store.directory(f.file.fileId), 'original'), 'corrupted test artifact')
  state = await service.get({ sessionId })
  assert.equal(state.requirements.reviewed, false); assert.ok(state.calculation.blockers.some(b => b.code === 'requirements_source_changed'))
  await assert.rejects(service.calculate({ sessionId, preparationId: oldPrep.id, requestId: randomUUID() }, 'user'), /过期/)
})

test('Agent read/get/Profile outputs include all mapped fields and derivation within 32KB', async t => {
  const f = await setup(t), tools = new Map(), exec = { agent: { id: f.sessionId } }
  installTools({ tools: { register: tool => tools.set(tool.name, tool) } }, f.service)
  const raw = await tools.get('mche_requirements_read').execute({ fileId: f.file.fileId, revision: 0 }, exec)
  const read = JSON.parse(raw); assert.equal(read.requirements.recordCount, 26)
  assert.ok(read.revision > 0)
  assert.match(read.requirements.notes.join('\n'), new RegExp(`顶层方案 revision=${read.revision}`))
  assert.match(read.requirements.notes.join('\n'), /ptsc=入口 P&T＋出口 SC，字段：refPressure、refTemperature、refSubcooling/)
  const proposal = JSON.parse(await tools.get('refrigerant_propose_selection').execute({
    name: read.requirements.refrigerantSuggestion.exactMatch.name, revision: read.revision, reason: '测试：直接复用精确匹配与读取后的版本',
  }, exec))
  assert.notEqual(proposal.ok, false); assert.ok(proposal.revision > read.revision)
  const stale = JSON.parse(await tools.get('mche_requirements_update_draft').execute({ revision: read.revision, boundary: ptm }, exec))
  assert.equal(stale.ok, false); assert.equal(stale.code, 'MCHE_INVALID'); assert.match(stale.message, /版本/)
  for (const name of ['mche_requirements_get', 'mche_calculation_profile_get', 'mche_case_get']) {
    const output = await tools.get(name).execute({}, exec)
    t.diagnostic(`${name}: ${output.length} chars, ${Buffer.byteLength(output)} bytes`)
    assert.ok(Buffer.byteLength(output) <= 32000)
    const result = JSON.parse(output); assert.notEqual(result.ok, false, `${name}: ${output}`)
    const profile = result.requirements?.profileDraft ?? result.profileDraft
    assert.equal(profile.sections.length, 4)
    const inlet = profile.sections.find(s => s.id === 'inlet')
    assert.deepEqual(inlet.fields.map(f => f.target), ['Pressure', 'Temperature', 'Mass Flow', 'Quality', 'Sat.T', 'SH(+)'])
    const sh = inlet.fields.find(f => f.key === 'refSuperheat')
    assert.equal(sh.entry.value, 27.4); assert.equal(sh.derivation.sources[0].entry.evidence.address, 'D6')
  }
  let state = await f.service.get({ sessionId: f.sessionId })
  state = await f.update(state, { boundary: ptm }); state = await f.confirm(state)
  await f.service.store.update(f.sessionId, {}, s => { s.requirements.document.rulesDigest = 'obsolete-test-rule' })
  state = await f.service.get({ sessionId: f.sessionId })
  assert.equal(state.requirements.reviewed, false); assert.equal(state.requirements.mappingStale, true)
  await assert.rejects(f.confirm(state), /映射规则已更新/)
  state = await f.read({ revision: state.revision })
  assert.equal(state.requirements.mappingStale, false); assert.equal(state.requirements.assessment.entries.refSuperheat.normalized, 27.4)
})
