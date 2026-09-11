import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { nativeFixture, post } from '../../dsh-excel-understanding/test/native-fixture.js'
import { mockCalculationResponse } from './calculation-model-fixture.js'
import { conditions, value, repo } from './calculation-fixture.js'

export async function seedCalculationHttp(f,sessionId,{confirm=true}={}) {
  const request=(path,args={})=>post(f,'/api/mche/'+path,{sessionId,...args})
  for(const [propose,confirm,name] of [['propose','confirm-tube','A44S'],['fin-propose','confirm-fin','B01'],['refrigerant-propose','confirm-refrigerant','WATER']]){
    const s=await request(propose,{name,reason:'浏览器及接口测试夹具；非工程验收'})
    await request(confirm,{revision:s.revision,proposalId:s.proposals.at(-1).id})
  }
  const state=await request('case'),g=state.snapshots[state.selections.tube.snapshotId].tube.geometry
  let s=await request('calculation-draft',{changes:{...conditions(),portWidth:value(g.flowAreaMm2/g.portHeightMm/g.portCount,'mm')}})
  if(confirm)s=await request('calculation-confirm',{revision:s.calculation.revision,reviewId:s.calculation.reviewId})
  return request('prepare')
}

test('real DSH dialogue/button calculation share server authorization, snapshots and persistent results', {timeout:90000,skip:process.platform!=='win32'},async t=>{
  const f=await nativeFixture(t,false,{respond:mockCalculationResponse,env:{MCHE_PYTHON_X86:join(repo,'.dsh/mche-python-x86/python.exe'),MCHE_RUNTIME_ROOT:join(repo,'runtime')}})
  const reply=await post(f,'/api/chat',{prompt:'计算验收初始化'})
  const sessionId=reply.sessionId,request=(path,args={},status=200)=>post(f,'/api/mche/'+path,{sessionId,...args},status)
  let state=await seedCalculationHttp(f,sessionId)
  assert.equal(state.calculation.preparation.calculationReady,true)
  const review={revision:state.calculation.revision,reviewId:state.calculation.reviewId}
  await request('calculation-confirm',review,409)
  await post(f,'/api/chat',{sessionId,prompt:'引用：“开始计算”'})
  assert.equal((await request('calculation-get')).runs.length,0)
  const chat=await post(f,'/api/chat',{sessionId,prompt:'开始计算'})
  assert.ok(chat.details.some(d=>d.mche?.runId),JSON.stringify(chat))
  let runs=(await request('calculation-get')).runs
  assert.equal(runs.length,1)
  let detail=await request('calculation-get',{runId:runs[0].runId,detail:true})
  assert.equal(detail.triggers[0].kind,'dialogue');assert.equal(detail.triggers[0].prompt,'开始计算')
  // A concurrent button intentionally reuses the active run. Wait before testing a separate trigger.
  for(let i=0;i<100&&['queued','running'].includes(detail.status);i++){
    await delay(30);detail=await request('calculation-get',{runId:runs[0].runId,detail:true})
  }
  assert.equal(detail.status,'failed')
  state=await request('case')
  const clicked=await request('calculate',{preparationId:state.calculation.preparation.id,requestId:'button-request'})
  assert.equal((await request('calculate',{preparationId:state.calculation.preparation.id,requestId:'button-request'})).runId,clicked.runId)
  await request('calculation-draft',{changes:{refTemperature:value(48,'°C')}})
  await post(f,'/api/chat',{sessionId,prompt:'修改参数并计算'})
  assert.equal((await request('calculation-get')).runs.length,2)
  await post(f,'/api/chat',{sessionId,prompt:'查看计算结果'})
  assert.match(JSON.stringify(f.received.at(-1).messages),/historical/)
  for(let i=0;i<100;i++){runs=(await request('calculation-get')).runs;if(runs.every(r=>!['queued','running'].includes(r.status)))break;await delay(30)}
  assert.ok(runs.every(r=>r.historical));assert.ok(runs.every(r=>r.status==='failed'))
  const before=await request('calculation-get')
  await f.close();await f.boot()
  assert.deepEqual(await request('calculation-get'),before)
  const restored=await post(f,'/api/session/open',{sessionId})
  assert.equal(restored.mcheWritable,true)
  detail=await request('calculation-get',{runId:clicked.runId,detail:true})
  assert.equal(detail.result.rawResult.length,64)
  await request('calculate',{preparationId:state.calculation.preparation.id,requestId:'stale-click'},409)
})

test('button confirms, prepares and calculates without model credentials or model requests', {timeout:30000,skip:process.platform!=='win32'},async t=>{
  const f=await nativeFixture(t,false,{respond:mockCalculationResponse,env:{MCHE_PYTHON_X86:join(repo,'.dsh/mche-python-x86/python.exe'),MCHE_RUNTIME_ROOT:join(repo,'runtime')}})
  const {sessionId}=await post(f,'/api/chat',{prompt:'计算验收初始化'})
  const request=(path,args={})=>post(f,'/api/mche/'+path,{sessionId,...args})
  let state=await seedCalculationHttp(f,sessionId,{confirm:false}),detail
  // Remove this isolated fixture's credential binding: calculation stays available without a model.
  await f.close()
  const patchFile=join(f.home,'fixture.json'),patches=JSON.parse(await readFile(patchFile,'utf8'))
  patches.find(p=>p.id==='llm-pi-ai').config.providers['excel-fixture'].apiKeyEnv='MCHE_TEST_MISSING_KEY'
  await writeFile(patchFile,JSON.stringify(patches));await f.boot()
  const offline=await post(f,'/api/session/open',{sessionId})
  assert.match(offline.readOnlyReason,/密钥/);assert.equal(offline.mcheWritable,true)
  state=await request('case')
  await request('calculation-confirm',{revision:state.calculation.revision,reviewId:state.calculation.reviewId})
  state=await request('prepare')
  const calls=f.received.length,offlineRun=await request('calculate',{preparationId:state.calculation.preparation.id,requestId:'offline-button'})
  for(let i=0;i<100;i++){
    detail=await request('calculation-get',{runId:offlineRun.runId,detail:true})
    if(!['queued','running'].includes(detail.status))break
    await delay(30)
  }
  assert.equal(detail.status,'failed');assert.equal(detail.result.rawResult.length,64)
  assert.equal(f.received.length,calls,'button must not call the offline model')
})
