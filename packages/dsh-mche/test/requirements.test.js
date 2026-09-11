import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseWorkbook } from '../../dsh-excel-understanding/src/parser.js'
import { ExcelService } from '../../dsh-excel-understanding/src/service.js'
import { extractRequirements } from '../src/requirements-parser.js'
import { normalizeRequirement, BOUNDARY_KEYS } from '../src/requirements-fields.js'
import { boundaryAssessment, emptyRequirements, recommendBoundary, REFRIGERANT_MODES, AIR_MODES, FLOW_MODES } from '../src/requirements-boundary.js'
import { McheService } from '../src/service.js'
import { installTools } from '../src/tools.js'
import { fixture, prepared, value, repo } from './calculation-fixture.js'

const name = '3-冷凝器客户输入.xls', sourcePath = join(repo, '答复_', name), bytes = await readFile(sourcePath)
const indexOf = () => parseWorkbook({ bytes, name })
const source = { fileId: randomUUID(), sha256: createHash('sha256').update(bytes).digest('hex'), name, indexSha256: 'index-test' }
const reqOf = index => ({ ...emptyRequirements(), document: extractRequirements(index ?? indexOf(), source) })
const entry = (v, u = '') => ({ value: v, unit: u, source: '用户测试输入；不是工程确认资料' })
const ptm = { refrigerant: 'ptm', air: 'ptrh', flow: 'volume' }
async function setup(t, prepare = false) {
  const { service, root } = await fixture(t, { probe: async () => ({ ready: true }) }), sessionId = randomUUID()
  const excel = new ExcelService({ root: join(root, 'excel'), parse: parseWorkbook }); service.requirements.excel = excel
  const original = prepare ? await prepared(service, sessionId) : await service.get({ sessionId })
  const { file } = await excel.import({ bytes, name: '客户提交.xls', sessionId })
  const state = await service.requirementsRead({ sessionId, fileId: file.fileId, revision: original.revision })
  return { service, root, excel, file, sessionId, state, original }
}
const update = (f, state, changes) => f.service.requirementsUpdate({ sessionId: f.sessionId, revision: state.revision, ...changes }, 'user')
const confirm = (f, state, origin = 'user') => f.service.requirementsConfirm({ sessionId: f.sessionId, revision: state.revision, reviewId: state.requirements.reviewId }, origin)

test('reference workbook: exactly 26 filled records, no blank/default options, raw/display/units/zero/No/questions and separate test conditions', async () => {
  const req = reqOf(), records = req.document.records, by = key => records.find(r => r.key === key)
  assert.deepEqual(records.map(r => r.source.address), [5,6,7,8,9,11,12,13,14,15,16,18,21,24,38,39,41,42,43,44,45,46,47,48,50,51].map(row => `D${row}`))
  assert.equal(records.length, 26); assert.ok(!by('refMassFlow')); assert.ok(!by('airVelocity')); assert.ok(!by('customer'))
  assert.equal(by('refTemperature').raw, '82,4 °C'); assert.equal(by('refTemperature').adopted.value, 82.4)
  assert.equal(by('refPressure').adopted.normalized, 2106000); assert.equal(by('refPressure').adopted.absolute, true)
  assert.equal(by('airHumidity').raw, 0.55); assert.equal(by('airHumidity').display, '55%'); assert.equal(by('airHumidity').adopted.normalized, 55)
  assert.equal(by('refSubcooling').adopted.normalized, 0); assert.equal(by('dust').raw, 'No')
  assert.equal(by('airAngle').raw, '90°?'); assert.equal(by('airAngle').adopted.normalized, null); assert.match(by('airAngle').issues.join(), /疑问/)
  assert.equal(by('spaceLength').unitBasis.unitCell, 'C21'); assert.equal(by('spaceLength').unitBasis.selection[0].address, 'C3')
  assert.equal(by('spaceLength').adopted.unit, 'mm'); assert.deepEqual(by('spaceLength').unitCandidates.map(u => u.unit), ['in', 'mm'])
  assert.equal(by('testConditions').group, 'test'); assert.equal(by('airTemperature').adopted.value, 32); assert.match(by('testConditions').raw, /42°C/)
  assert.equal(by('background').source.merges[0], 'D41:G41'); assert.ok(records.every(r => r.verification === 'unverified'))
  assert.equal(createHash('sha256').update(await readFile(sourcePath)).digest('hex'), source.sha256)
})

test('recognition uses title/structure across renamed, hidden and shifted sheets; unknown filled labels stay reference; incomplete/ambiguous sheets fail closed', () => {
  const index = indexOf(), sheet = index.sheets[0]
  // Shift every cell and merge by two columns and eight rows without writing any workbook.
  const shift = a => a.replace(/^([A-Z]+)(\d+)$/, (_, col, row) => `${String.fromCharCode(col.charCodeAt(0)+2)}${Number(row)+8}`)
  sheet.name = 'Renamed'; sheet.hidden = 1
  sheet.cells = Object.fromEntries(Object.values(sheet.cells).map(c => [shift(c.address), { ...c, address: shift(c.address) }]))
  sheet.merges = sheet.merges.map(range => range.split(':').map(shift).join(':'))
  assert.equal(extractRequirements(index, { ...source, name: 'arbitrary.bin' }).records.length, 26)
  assert.equal(extractRequirements(index, source).records[0].source.address, 'F13')
  const extra = indexOf(); extra.sheets[0].cells.A53 = { ...extra.sheets[0].cells.A5, address: 'A53', raw: 'Custom warranty requirement', display: 'Custom warranty requirement' }
  extra.sheets[0].cells.D53 = { ...extra.sheets[0].cells.D45, address: 'D53', raw: false, display: 'FALSE' }
  assert.equal(extractRequirements(extra, source).records.at(-1).adopted.value, false)
  const noTitle = indexOf(); delete noTitle.sheets[0].cells.A1
  assert.throws(() => extractRequirements(noTitle, source), /未按/)
  const partial = indexOf(); partial.sheets[0].complete = false; assert.throws(() => extractRequirements(partial, source), /不完整/)
  const duplicate = indexOf(); duplicate.sheets.push({ ...duplicate.sheets[0], name: 'second' })
  assert.throws(() => extractRequirements(duplicate, source), /多张/)
  assert.equal(extractRequirements(duplicate, source, 'second').records.length, 26)
})

test('lexical conversion only: percentages, decimal comma, zero, negative Celsius, pressure basis and unresolved formula/units', () => {
  for (const [key, v, u, n] of [['refQuality','35%','%',0.35],['airHumidity','0','%',0],['refTemperature','-20','°C',253.15],['refPressure','2','bar',200000],['airHumidityRatio','8','g/kg',0.008],['refSuperheat','9','°F',5]]) assert.ok(Math.abs(normalizeRequirement(key, entry(v,u)).entry.normalized-n)<1e-12)
  for (const [key,v,u] of [['refPressure','21 barg','bar'],['refPressure',21,''],['refMassFlow','1,000','kg/h'],['refQuality','110','%'],['airHumidity','55?','%'],['refTemperature','TBD','°C'],['airVolumeFlow',0,'m3/h']]) assert.equal(normalizeRequirement(key,entry(v,u)).entry.normalized,null)
  const index = indexOf(); index.sheets[0].cells.D6.formula = '40+42.4'
  assert.equal(reqOf(index).document.records.find(r=>r.key==='refTemperature').adopted.normalized,null)
  index.sheets[0].cells.C3.raw = '□'; index.sheets[0].cells.C3.display = '□'
  assert.equal(reqOf(index).document.records.find(r=>r.key==='spaceLength').adopted.normalized,null)
  const imperial=indexOf(),sheet=imperial.sheets[0]
  sheet.cells.B3.display='■';sheet.cells.C3.display='□'
  sheet.cells.D10={...sheet.cells.D21,address:'D10',raw:900,display:'900'}
  const mass=reqOf(imperial).document.records.find(r=>r.key==='refMassFlow')
  assert.deepEqual(mass.unitCandidates.map(c=>c.unit),['lbm/h','kg/h'])
  assert.equal(mass.adopted.unit,'lbm/h');assert.equal(mass.adopted.normalized,0.1133980925)
  assert.equal(mass.unitBasis.unitCell,'B10')
  assert.equal(normalizeRequirement('airTemperature',entry('25℃','°C')).entry.normalized,298.15)
})

test('all 42 Boundary combinations have a unique active input set, dynamic roles and explainable alternatives', () => {
  const req = reqOf(); assert.deepEqual(recommendBoundary(req).proposed, { refrigerant: 'ptsc', air: 'ptrh', flow: 'volume' })
  let count = 0
  for (const refrigerant of Object.keys(REFRIGERANT_MODES)) for (const air of Object.keys(AIR_MODES)) for (const flow of Object.keys(FLOW_MODES)) {
    req.boundary = { refrigerant, air, flow }; const a = boundaryAssessment(req); count++
    assert.equal(a.keys.length, 7); assert.equal(new Set(a.keys).size, 7)
    assert.equal(a.keys.filter(k=>['airVelocity','airVolumeFlow'].includes(k)).length,1)
    assert.equal(a.executionSupported, refrigerant==='ptm'&&air==='ptrh'&&flow==='volume')
    assert.equal(a.roles.heatLoad,'design_target'); assert.equal(a.roles.spaceLength,'design_target'); assert.equal(a.roles.airAngle,'reference'); assert.equal(a.roles.testConditions,'test_reference')
  }
  assert.equal(count,42)
  req.boundary=ptm; assert.ok(boundaryAssessment(req).missing.some(i=>i.field==='refMassFlow'))
  assert.equal(req.document.records.find(r=>r.key==='refSubcooling').adopted.value,0)
})

test('requirements confirmation atomically replaces boundary draft, retains all evidence, invalidates old confirmation/package and blocks unsupported execution', async t => {
  const f = await setup(t,true), { service, sessionId } = f, oldPrep = f.original.calculation.preparation
  assert.equal(oldPrep.calculationReady,true)
  assert.equal(f.state.requirements.boundaryDifference.before.refrigerant,'ptm')
  assert.equal(f.state.calculation.confirmed,false); assert.equal(f.state.calculation.preparation,null)
  let state = await update(f,f.state,{boundary:{refrigerant:'ptsc',air:'ptrh',flow:'volume'},supplements:{airPressure:entry('101.325','kPa')}})
  assert.equal(state.requirements.assessment.inputComplete,true)
  assert.ok(state.requirements.difference.some(d=>d.field==='refMassFlow'&&d.after===null))
  await assert.rejects(confirm(f,state,'agent'),/只能由用户/)
  state = await confirm(f,state)
  assert.equal(state.requirements.reviewed,true); assert.equal(state.calculation.confirmed,false)
  assert.equal(state.calculation.preparation,null); assert.equal(state.calculation.draft.refMassFlow,undefined)
  assert.equal(state.calculation.draft.airTemperature.normalized,305.15)
  assert.equal(state.calculation.draft.finnedLength.normalized,f.original.calculation.draft.finnedLength.normalized)
  assert.equal(state.calculation.boundary.inputs.refSubcooling.value,0)
  assert.equal(state.calculation.requirementsSnapshot.document.records.length,26)
  assert.ok(state.calculation.blockers.some(b=>b.code==='boundary_unsupported'))
  assert.ok(state.calculation.blockers.some(b=>b.code==='requirements_refrigerant_mismatch'))
  await assert.rejects(service.calculate({sessionId,preparationId:oldPrep.id,requestId:randomUUID()},'user'),/过期/)
  state=await service.calculationConfirm({sessionId,revision:state.calculation.revision,reviewId:state.calculation.reviewId},'user')
  state=await service.prepare({sessionId})
  assert.equal(state.calculation.preparation.native,null); assert.equal(state.calculation.preparation.calculationReady,false)
  assert.equal(state.calculation.preparation.requirementsSnapshot.document.source.sha256,source.sha256)
  await assert.rejects(service.calculate({sessionId,preparationId:state.calculation.preparation.id,requestId:randomUUID()},'user'),/未就绪/)
  await assert.rejects(service.calculationUpdateDraft({sessionId,changes:{refMassFlow:value(900,'kg/h')}}),/客户需求/)
})

test('PTM return preserves inactive values, missing input blocks without fabricating, restoring service keeps state and stale revisions conflict', async t => {
  const f = await setup(t,true), {service,sessionId,root,excel} = f
  let state = await update(f,f.state,{boundary:ptm})
  state = await confirm(f,state) // Requirement review is allowed even with incomplete inputs.
  assert.equal(state.requirements.reviewed,true); assert.equal(state.requirements.assessment.inputComplete,false)
  assert.equal(state.calculation.draft.refMassFlow,undefined); assert.equal(state.calculation.draft.airPressure,undefined)
  const snapshot = structuredClone(state.calculation.requirementsSnapshot)
  state=await update(f,state,{supplements:{refMassFlow:entry('900','kg/h'),airPressure:entry('101325','Pa')},edits:{'refrigerant:D5':entry('WATER')}})
  assert.equal(state.requirements.reviewed,false); assert.equal(state.calculation.confirmed,false)
  state=await confirm(f,state)
  assert.equal(state.requirements.assessment.inputComplete,true); assert.equal(state.calculation.draft.refMassFlow.normalized,0.25)
  state=await service.calculationConfirm({sessionId,revision:state.calculation.revision,reviewId:state.calculation.reviewId},'user')
  state=await service.prepare({sessionId}); assert.equal(state.calculation.preparation.calculationReady,true)
  assert.equal(state.calculation.preparation.native.refrigerant[6],0.25)
  const oldReview=state
  state=await update(f,state,{boundary:{refrigerant:'tsat_sh_sc',air:'ptwb',flow:'velocity'},supplements:{refSuperheat:entry('27.4','K'),airWetBulb:entry('25','°C'),airVelocity:entry('2','m/s')}})
  assert.equal(state.requirements.supplements.refMassFlow.value,'900')
  assert.equal(state.requirements.assessment.entries.airVolumeFlow.value,4)
  await assert.rejects(confirm(f,oldReview),/版本已更新/)
  state=await confirm(f,state)
  assert.equal(state.calculation.draft.refMassFlow,undefined); assert.equal(state.calculation.draft.airVolumeFlow,undefined)
  assert.equal(state.calculation.draft.airHumidity,undefined)
  assert.equal(Object.keys(state.calculation.boundary.inputs).length,7)
  const restarted=new McheService({root,catalogPath:service.catalogPath,excel,calculation:{process:service.calculations.process}})
  assert.deepEqual((await restarted.get({sessionId})).requirements.document,state.requirements.document)
  assert.deepEqual((await restarted.get({sessionId})).calculation.boundary,state.calculation.boundary)
  await restarted.close()
  state=await update(f,state,{boundary:ptm}); state=await confirm(f,state)
  assert.equal(state.calculation.draft.refMassFlow.normalized,0.25); assert.equal(state.calculation.draft.airVolumeFlow.value,4/3600)
  assert.equal(state.requirements.assessment.entries.refSuperheat.normalized,27.4)
  assert.equal(snapshot.document.records[0].raw,'R454C')
  assert.equal((await excel.artifact({fileId:f.file.fileId,sessionId,artifact:'original'})).bytes.equals(bytes),true)
})

test('cross-session, concurrent review, edits after diff, source corruption and confirmation/schema injection fail closed', async t => {
  const f=await setup(t),{service,sessionId}=f
  const other=randomUUID(); await assert.rejects(service.requirementsRead({sessionId:other,fileId:f.file.fileId,revision:0}),/不属于/)
  let state=await update(f,f.state,{boundary:ptm})
  await assert.rejects(service.requirementsConfirm({sessionId:other,revision:0,reviewId:state.requirements.reviewId},'user'),/读取需求/)
  await assert.rejects(update(f,state,{confirmation:{confirmed:true}}),/未知字段/)
  await assert.rejects(update(f,state,{edits:{'unknown:Z99':entry('hello')}}),/未知字段/)
  await assert.rejects(update(f,state,{supplements:{airTemperature:entry(42,'°C')}}),/未知字段/)
  const result=await Promise.allSettled([confirm(f,state),confirm(f,state)])
  assert.equal(result.filter(r=>r.status==='fulfilled').length,1); assert.equal(result.filter(r=>r.status==='rejected').length,1)
  state=await service.get({sessionId})
  state=await update(f,state,{edits:{'airTemperature:D13':entry('33','°C')}})
  const stale=state
  state=await service.calculationUpdateDraft({sessionId,changes:{tubeCount:value(30,'个')}})
  await assert.rejects(confirm(f,stale),/版本已更新/)
  await writeFile(join(f.excel.store.directory(f.file.fileId),'original'),'tampered')
  await assert.rejects(confirm(f,state),/摘要不一致/)
  assert.equal((await service.get({sessionId})).requirements.reviewed,false)
})

test('Agent shares requirements service, can propose but never confirm, response stays bounded and source fields are not writable', async t => {
  const f=await setup(t),tools=new Map()
  installTools({tools:{register:tool=>tools.set(tool.name,tool)}},f.service)
  assert.equal(tools.has('mche_requirements_confirm'),false)
  for(const method of ['mche_requirements_get','mche_requirements_recommend_boundary']) {
    const raw=await tools.get(method).execute({}, {agent:{id:f.sessionId}})
    assert.ok(Buffer.byteLength(raw)<=32000)
    const result=JSON.parse(raw);assert.equal(result.requirements.recordCount,26);assert.equal(result.mche.view,'requirements')
    assert.equal(result.requirements.recommendation.proposed.refrigerant,'ptsc')
  }
  const bad=await tools.get('mche_requirements_update_draft').execute({revision:f.state.revision,document:{}},{agent:{id:f.sessionId}})
  assert.equal(JSON.parse(bad).ok,false)
  await assert.rejects(tools.get('mche_requirements_read').execute({sessionId:randomUUID()},{agent:{id:f.sessionId}}),/其他会话/)
})
