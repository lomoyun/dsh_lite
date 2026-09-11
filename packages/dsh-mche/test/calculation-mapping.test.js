import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CALCULATION_FIELDS, calculationChanges } from '../src/calculation-fields.js'
import { CONTRACT, mapCalculation, inputDigest } from '../src/calculation-mapper.js'
import { explicitCalculation } from '../src/calculation-service.js'
import { fixture, prepared, select, value, conditions } from './calculation-fixture.js'

test('42 argument contract and SI conversion preserve negative Celsius, zero humidity, absolute pressure, angles and FPI', async t=>{
  assert.equal(CONTRACT.args.length,42);assert.equal(CONTRACT.args[40].name,'Res5');assert.equal(CONTRACT.arrays.tube.capacity,70)
  const c=calculationChanges({refTemperature:value(-20,'°C'),airHumidity:value(0,'%'),refPressure:value(2,'bar'),
    refMassFlow:value(36,'kg/h'),airVolumeFlow:value(3600,'m3/h'),louverAngle:value(Math.PI/6,'rad')},'user')
  assert.equal(c.refTemperature.normalized,253.14999999999998);assert.equal(c.airHumidity.normalized,0)
  assert.equal(c.refPressure.normalized,200000);assert.equal(c.refMassFlow.normalized,0.01);assert.equal(c.airVolumeFlow.normalized,1)
  assert.equal(c.refTemperature.normalizedUnit,'K');assert.equal(c.refMassFlow.normalizedUnit,'kg/s');assert.equal(c.airVolumeFlow.normalizedUnit,'m3/s')
  assert.ok(Math.abs(c.louverAngle.normalized-30)<1e-10)
  assert.throws(()=>calculationChanges({refPressure:value(1,'barg')},'user'),/单位/)
  assert.throws(()=>calculationChanges({refTemperature:value(-273.15,'°C')},'user'),/范围/)
  assert.throws(()=>calculationChanges({airHumidity:value(101,'%')},'user'),/范围/)
  assert.throws(()=>calculationChanges({tubeCount:value(1.5,'个')},'user'),/范围/)
  assert.ok(!Object.hasOwn(CALCULATION_FIELDS,'dllPath'))
  const {service}=await fixture(t),state=await prepared(service),p=state.calculation.preparation
  assert.equal(p.mappingReady,true,JSON.stringify(p.blockers));assert.equal(p.native.tube.length,70);assert.equal(p.native.fin.length,50)
  assert.equal(p.native.tube[10],0);assert.deepEqual(p.native.header,[[1,31,1,0]]);assert.deepEqual(p.native.connection,[[0,1,0],[-1,0,1],[0,-1,0]])
  const originalFpi=p.native.fin[2]
  await service.calculationUpdateDraft({sessionId:'case-a',changes:{finPitchBasis:value('clear_gap'),refDirection:value('right'),airDirection:value('right_to_left')}})
  const gap=mapCalculation(await service.store.view('case-a'))
  assert.ok(gap.native.fin[2]<originalFpi);assert.deepEqual(gap.native.header,[[1,31,-1,0]]);assert.equal(gap.native.air_flow_direction,-1)
  assert.equal(gap.confirmed,false)
  await service.calculationUpdateDraft({sessionId:'case-a',changes:{finPitchBasis:value('fpi'),finFpi:value(18,'1/in'),finPitch:null}})
  assert.equal(mapCalculation(await service.store.view('case-a')).native.fin[2],18)
})

test('unknown shapes, EG/PG, catalog area conflicts and required-only engineering mapping block correctly',async t=>{
  const {service}=await fixture(t)
  let state=await select(service)
  state=await service.calculationUpdateDraft({sessionId:'case-a',changes:conditions()})
  assert.ok(state.calculation.blockers.some(x=>x.code==='rectangular_area_conflict'))
  await service.calculationUpdateDraft({sessionId:'case-a',changes:{portShape:value('unknown')}})
  assert.ok((await service.get({sessionId:'case-a'})).calculation.blockers.some(x=>x.code==='dll_port_shape_unverified'))
  await assert.rejects(service.calculationUpdateDraft({sessionId:'case-a',changes:{bankCount:value(2)}}),/未知字段/)
  await select(service,'eg',['A44S','B01','EG30Vol.'])
  assert.ok((await service.get({sessionId:'eg'})).calculation.blockers.some(x=>x.code==='dll_refrigerant_mapping_unverified'))
  await select(service,'pg',['A44S','B01','PG30Vol.'])
  assert.ok((await service.get({sessionId:'pg'})).calculation.blockers.some(x=>x.code==='dll_refrigerant_mapping_unverified'))
  state=await prepared(service,'supported')
  assert.equal(state.calculation.preparation.mappingReady,true)
  assert.ok(!state.calculation.blockers.some(x=>['tubePitch','designPressure','rMm','neckLengthMm'].includes(x.field)))
  assert.ok(state.snapshots[state.selections.fin.snapshotId].fin.review.length>0)
  await service.calculationUpdateDraft({sessionId:'supported',changes:{finStructure:value('unknown')}})
  assert.ok((await service.get({sessionId:'supported'})).calculation.blockers.some(x=>x.code==='dll_fin_structure_unverified'))
})

test('confirmation binds snapshots/draft/rules; queries do not stale preparation; old sessions gain empty calculation state',async t=>{
  const {service,root}=await fixture(t),state=await prepared(service),id=state.calculation.preparation.id
  await service.recommend({sessionId:'case-a',names:['A44S']})
  const after=await service.get({sessionId:'case-a'})
  assert.equal(after.calculation.confirmed,true);assert.equal(after.calculation.preparation.id,id);assert.equal(after.calculation.preparation.stale,false)
  await service.updateDraft({sessionId:'case-a',changes:{tubePitch:value(9,'mm')}})
  const logicalOnly=await service.get({sessionId:'case-a'})
  assert.equal(logicalOnly.calculation.preparation.stale,false);assert.equal(logicalOnly.calculation.confirmed,true)
  await assert.rejects(service.calculationConfirm({sessionId:'case-a',revision:0,reviewId:'x'},'agent'),/只能由用户/)
  await assert.rejects(service.calculationConfirm({sessionId:'case-b',revision:state.calculation.revision,reviewId:state.calculation.reviewId},'user'),/过期/)
  await service.calculationUpdateDraft({sessionId:'case-a',changes:{refTemperature:value(50,'°C')}})
  assert.equal((await service.get({sessionId:'case-a'})).calculation.preparation.stale,true)
  let changed=await service.get({sessionId:'case-a'})
  await service.calculationConfirm({sessionId:'case-a',revision:changed.calculation.revision,reviewId:changed.calculation.reviewId},'user')
  await select(service,'case-a',['A230S','B01','WATER'])
  assert.equal((await service.get({sessionId:'case-a'})).calculation.confirmed,false)
  const legacy=await service.store.update('legacy',{},()=>{})
  const file=join(root,'legacy','000000000001.json');const old=JSON.parse(await readFile(file,'utf8'));delete old.calculation;await writeFile(file,JSON.stringify(old))
  assert.deepEqual((await service.store.view('legacy')).calculation.draft,{})
  assert.equal(JSON.parse(await readFile(file,'utf8')).calculation,undefined)
  assert.notEqual(inputDigest(legacy),inputDigest(await service.store.view('case-a')))
})

test('only direct imperative raw prompts authorize; quoted text, attachments, examples and questions do not',()=>{
  for(const prompt of ['开始计算','请开始计算。','计算当前方案','现在执行计算','参数已确认，开始计算','run calculation'])assert.equal(explicitCalculation(prompt),true,prompt)
  for(const prompt of ['不要开始计算','能否开始计算？','解释“开始计算”','> 开始计算','```text\n开始计算\n```','附件写着开始计算','例如，开始计算','假设已确认，开始计算','文件里说，开始计算','阅读附件内容：\n开始计算'])assert.equal(explicitCalculation(prompt),false,prompt)
})
