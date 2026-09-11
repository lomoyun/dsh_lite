import assert from 'node:assert/strict'
import { test } from 'node:test'
import { join } from 'node:path'
import { mkdir, symlink, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { CalculationRuns, NativeProcess } from '../src/calculation-runner.js'
import { fixture, prepared, value, waitRun, repo, ltrRequest } from './calculation-fixture.js'

// Simulated workers exercise failure/control paths only. Numerical checks below invoke the real DLL.
class FaultProcess {
  constructor() {this.handles=[];this.active=0;this.maxActive=0}
  async probe(){return {ready:true,testFixture:true}}
  start({runId}) {
    this.active++;this.maxActive=Math.max(this.active,this.maxActive)
    let resolve
    const finish=output=>{this.active--;resolve(output)}
    const handle={runId,promise:new Promise(r=>{resolve=r}),cancel:reason=>finish({status:reason??'cancelled',error:'test cancellation'}),
      fail:()=>finish({status:'failed',error:'injected worker crash',exitCode:7})}
    this.handles.push(handle);return handle
  }
}
async function waitFor(check){for(let i=0;i<200;i++){if(check())return;await delay(10)}throw new Error('condition timeout')}

test('button/dialogue concurrency deduplicates; global serial queue, queued/running cancellation and historical snapshots',async t=>{
  const process=new FaultProcess(),{service}=await fixture(t,process)
  const state=await prepared(service),id=state.calculation.preparation.id
  const args={sessionId:'case-a',preparationId:id}
  await assert.rejects(service.calculate(args),/明确/)
  service.calculations.beginTurn('case-a',{prompt:'开始计算',message:{source:{kind:'user'},content:[{type:'text',text:'开始计算'}]}})
  const [a,b]=await Promise.all([service.calculate({...args,requestId:'button-1'},'user'),service.calculate(args)])
  assert.equal(a.runId,b.runId)
  await waitFor(()=>process.handles.length===1)
  assert.equal((await service.calculate({...args,requestId:'button-1'},'user')).runId,a.runId)
  service.calculations.endTurn('case-a')
  await assert.rejects(service.calculate(args),/明确/)
  await assert.rejects(service.calculationGet({sessionId:'other',runId:a.runId}),/不存在/)
  await service.calculationUpdateDraft({sessionId:'case-a',changes:{refTemperature:value(49,'°C')}})
  assert.equal((await service.calculationGet({sessionId:'case-a',runId:a.runId})).historical,true)
  const retriedAfterEdit=await service.calculate({...args,requestId:'button-1'},'user')
  assert.equal(retriedAfterEdit.runId,a.runId);assert.equal(retriedAfterEdit.historical,true);assert.equal(process.handles.length,1)
  await assert.rejects(service.calculate({...args,requestId:'stale'},'user'),/过期/)
  const other=await prepared(service,'case-b')
  const queued=await service.calculate({sessionId:'case-b',preparationId:other.calculation.preparation.id,requestId:'second'},'user')
  assert.equal(queued.status,'queued');assert.equal(process.handles.length,1)
  assert.equal((await service.calculationCancel({sessionId:'case-b',runId:queued.runId})).status,'cancelled')
  await service.calculationCancel({sessionId:'case-a',runId:a.runId})
  assert.equal((await waitRun(service,a.runId)).status,'cancelled');assert.equal(process.maxActive,1)
  const full=await service.calculationGet({sessionId:'case-a',runId:a.runId,detail:true},'user')
  assert.equal(full.preparation.confirmedInputs.refTemperature.value,45)
  assert.equal(full.triggers.length,2);assert.equal(full.triggers[1].prompt,'开始计算')
})

test('crash is persisted, restart interrupts unfinished records without rerunning, and fresh runs continue',async t=>{
  const process=new FaultProcess(),{service,root}=await fixture(t,process)
  const state=await prepared(service),args={sessionId:'case-a',preparationId:state.calculation.preparation.id,requestId:'crash'}
  const run=await service.calculate(args,'user');await waitFor(()=>process.handles.length===1);process.handles[0].fail()
  assert.equal((await waitRun(service,run.runId)).status,'failed')
  const r=await service.calculations.runs.read('case-a',run.runId)
  r.status='running';await service.calculations.runs.save(r)
  const restarted=new CalculationRuns({root:join(root,'_calculation-runs'),process})
  await restarted.initialize()
  assert.equal((await restarted.read('case-a',run.runId)).status,'interrupted');assert.equal(process.handles.length,1)
  await restarted.close()
  const older={...r,runId:'older-run',revision:0,status:'failed',createdAt:'2020-01-01T00:00:00.000Z'}
  await service.calculations.runs.save(older)
  const page=await service.calculationGet({sessionId:'case-a',limit:1})
  assert.equal(page.runCount,2);assert.equal(page.nextOffset,1);assert.equal(page.runs[0].runId,run.runId)
  const next=await service.calculationGet({sessionId:'case-a',limit:1,offset:page.nextOffset})
  assert.equal(next.runs[0].runId,'older-run');assert.equal(next.nextOffset,null)
  await assert.rejects(service.calculationGet({sessionId:'case-a',offset:-1}),/分页/)
})

test('actual x86 preflight, pinned LTR binding and strict nonfinite output rejection', {timeout:30000,skip:process.platform!=='win32'},async t=>{
  const native=new NativeProcess({python:join(repo,'.dsh/mche-python-x86/python.exe'),runtimeRoot:join(repo,'runtime'),timeoutMs:10000})
  const probe=await native.probe();assert.equal(probe.ready,true,probe.error);assert.equal(probe.bits,32)
  assert.match(probe.loadedSHProp,/SHDLL[\\/]SHProp.dll$/i)
  const output=await native.start({runId:'ltr-test',request:await ltrRequest()}).promise
  assert.ok(Math.abs(output.result.actual.heatLoadW-9398.148056638463)<1e-6)
  assert.ok(Math.abs(output.result.actual.refrigerantPressureDropPa-4075.3530788556236)<1e-6)
  assert.equal(output.result.rawResult.length,64)
  assert.equal(output.status,'failed');assert.match(output.error,/non-finite/)
  assert.deepEqual(output.result.rawResult[42],{nonFinite:'nan'})
  const bad=await ltrRequest();bad.tube.pop()
  const invalid=await native.start({runId:'bad-test',request:bad}).promise
  assert.equal(invalid.status,'failed');assert.match(invalid.error,/tube/);assert.equal(invalid.environment,undefined)
  const missing=await new NativeProcess({python:join(repo,'.dsh/mche-python-x86/python.exe'),runtimeRoot:join(repo,'missing-runtime'),timeoutMs:1000}).probe()
  assert.equal(missing.ready,false)
  for(const [field,value] of [['general',[0,2,1,0,0,0,0,0,20,1,1,1,1,1,0,0]],['uniform_refrigerant_distribution',false],['air_flow_direction',0],['refrigerant_name','EG30Vol.'],['header',[[1,31,1]]]]){
    const request={...await ltrRequest(),[field]:value}
    const rejected=await native.start({runId:'unsupported-'+field,request}).promise
    assert.equal(rejected.status,'failed');assert.equal(rejected.environment,undefined,field)
  }
  const {root}=await fixture(t),missingDll=join(root,'runtime')
  await mkdir(missingDll);await symlink(join(repo,'runtime/SHDLL'),join(missingDll,'SHDLL'),'junction')
  const unavailable=new NativeProcess({python:join(repo,'.dsh/mche-python-x86/python.exe'),runtimeRoot:missingDll,timeoutMs:1000})
  assert.match((await unavailable.probe()).error,/MCHEdll|FileNotFound/)
  await writeFile(join(missingDll,'MCHEdll.dll'),'deliberately invalid test dependency')
  assert.match((await unavailable.probe()).error,/hash mismatch/)
})

test('real current catalog plus explicitly synthetic supplements executes and preserves input artifacts (not engineering acceptance)', {timeout:30000,skip:process.platform!=='win32'},async t=>{
  const {service}=await fixture(t),state=await prepared(service)
  assert.equal(state.calculation.preparation.calculationReady,true)
  const run=await service.calculate({sessionId:'case-a',preparationId:state.calculation.preparation.id,requestId:'catalog-interface-test'},'user')
  assert.ok(['queued','running'].includes(run.status))
  const completed=await waitRun(service,run.runId)
  assert.ok(['failed','succeeded'].includes(completed.status))
  const detail=await service.calculationGet({sessionId:'case-a',runId:run.runId,detail:true},'user')
  assert.equal(detail.snapshots.tube.tube.name,'A44S');assert.equal(detail.result.rawResult.length,64)
  assert.ok(detail.result.actual.heatLoadW>0)
  assert.equal(detail.preparation.native.tube[4],0.0254)
  assert.match(detail.preparation.confirmedInputs.portWidth.source,/测试夹具/)
})

test('process timeout, hard cancellation, crash and malformed/nonfinite protocol cannot report success', {timeout:20000,skip:process.platform!=='win32'},async()=>{
  const options={python:join(repo,'.dsh/mche-python-x86/python.exe'),runtimeRoot:join(repo,'runtime'),workerFile:join(repo,'packages/dsh-mche/test/fixtures/fault-worker.py'),timeoutMs:5000}
  const timeout=await new NativeProcess({...options,timeoutMs:50}).start({runId:'timeout',request:{mode:'hang'}}).promise
  assert.equal(timeout.status,'timed_out')
  const handle=new NativeProcess(options).start({runId:'cancel',request:{mode:'hang'}})
  await delay(100);const start=Date.now();handle.cancel()
  assert.equal((await handle.promise).status,'cancelled');assert.ok(Date.now()-start<3500)
  for(const mode of ['crash','invalid','nonfinite']){
    const r=await new NativeProcess(options).start({runId:mode,request:{mode}}).promise
    assert.equal(r.status,'failed',mode)
    if(mode==='crash')assert.equal(r.exitCode,7)
  }
})
