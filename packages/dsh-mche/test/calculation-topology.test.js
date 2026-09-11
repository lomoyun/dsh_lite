import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { normalizeTopology, projectTopology, topologyLayout, applyTopology } from '../src/calculation-topology.js'
import { TOPOLOGY_CONTRACT, TOPOLOGY_DIGEST, PROFILE_DIGEST, CONTRACT } from '../src/calculation-mapper.js'
import { fixture, prepared, repo, value, waitRun, ltrRequest } from './calculation-fixture.js'
import { topology, fakeProcess } from './topology-fixture.js'
import { installTools } from '../src/tools.js'
import { CaseStore } from '../src/store.js'

test('original 2Pass and 3Pass global ranges and exact connection matrices', async()=>{
  const samples=JSON.parse(await readFile(new URL('../../../docs/verification/evidence/flow-topology/source-samples.json',import.meta.url)))
  for (const sample of samples) {
    const counts=[]
    sample.header.forEach(([a,b,d,r])=>(counts[r]??=[]).push(b-a+1))
    const top=topology(counts), ids=top.rows.flatMap(r=>r.passes)
    ids.forEach((p,i)=>p.direction=sample.header[i][2]===1?'left':'right')
    const order=[];let node=sample.connection[0].indexOf(1)
    while(node!==ids.length+1){order.push(ids[node-1].id);node=sample.connection[node].indexOf(1)}
    top.order=order
    const mapped=topologyLayout(normalizeTopology(top))
    assert.deepEqual(mapped.header,sample.header);assert.deepEqual(mapped.connection,sample.connection)
  }
})

test('topology bounds, complete order, parallel branches, pending and air-independent numbering',()=>{
  const max=normalizeTopology(topology(Array.from({length:5},()=>[80,80,80,80,80,100])))
  const layout=topologyLayout(max);assert.equal(layout.passes.length,30);assert.equal(layout.header.at(-1)[1],2500)
  for (const mutate of [t=>t.rows.push(...t.rows),t=>t.rows[0].passes.push(...t.rows[0].passes,...t.rows[0].passes,...t.rows[0].passes),
    t=>t.rows[0].passes[0].tubeCount=0,t=>t.rows[0].passes[0].tubeCount=1.5,t=>t.rows[0].passes[0].tubeCount=500,
    t=>t.rows[0].passes[0].tubeCount=-1,t=>t.rows[0].passes[0].direction=0,t=>t.order.pop(),t=>t.order[1]=t.order[0],
    t=>t.order[0]='missing',t=>t.rows[0].passes[1].id=t.rows[0].passes[0].id,t=>t.schemaVersion=2,
    t=>t.connection='network',t=>t.source='',t=>t.rows[0].passes[0].startTube=55]) {
    const t=topology();mutate(t);assert.throws(()=>normalizeTopology(t))
  }
  const missing=projectTopology();assert.equal(missing.rows[0].passes[0].tubeCount,null)
  assert.equal(topologyLayout(missing).header,null)
  const pending=topology([[null,5],[7]]);assert.deepEqual(topologyLayout(pending).passes.map(p=>p.startTube),[null,null,null])
  const parallel=topologyLayout(topology([[2,3],[4,5]],'parallel'))
  assert.deepEqual(parallel.edges,[[0,1],[1,2],[2,5],[0,3],[3,4],[4,5]])
  assert.deepEqual(parallel.header,[[1,2,1,0],[3,5,-1,0],[6,9,1,1],[10,14,-1,1]])
})

test('save, stale packages, immutable history, legacy projection and dialogue single-row boundaries',async t=>{
  const {service,root}=await fixture(t,fakeProcess);let state=await prepared(service),old=state.calculation.preparation
  const run=await service.calculate({sessionId:'case-a',preparationId:old.id,requestId:'old'},'user');await waitRun(service,run.runId)
  const top=topology([[10,8],[12,6]])
  await assert.rejects(service.calculationUpdateDraft({sessionId:'case-a',topology:top,changes:{}}),/排/)
  await assert.rejects(service.calculationUpdateDraft({sessionId:'case-a',topology:top,changes:{}},'user'),/revision/)
  state=await service.calculationUpdateDraft({sessionId:'case-a',revision:state.calculation.revision,topology:top,changes:{}},'user')
  assert.equal(state.calculation.confirmed,false);assert.equal(state.calculation.preparation.stale,true);assert.equal(state.calculation.draft.tubeCount,undefined)
  const rev=state.calculation.revision
  await assert.rejects(service.calculationUpdateDraft({sessionId:'case-a',revision:rev-1,topology:top},'user'),/更新/)
  await assert.rejects(service.calculationUpdateDraft({sessionId:'case-a',revision:rev,topology:topology([[2]])}),/单排/)
  await assert.rejects(service.calculationUpdateDraft({sessionId:'case-a',changes:{refTemperature:value(40,'°C')}}),/单排/)
  await assert.rejects(service.calculationUpdateDraft({sessionId:'case-a',changes:{tubeCount:value(99,'个')}},'user'),/统一管理/)
  const fresh=await service.get({sessionId:'case-a'});assert.deepEqual(fresh.calculation.topology,state.calculation.topology)
  assert.deepEqual((await new CaseStore(root).view('case-a')).calculation.topology,state.calculation.topology)
  assert.equal((await service.get({sessionId:'case-b'})).calculation.topology.rows.length,1)
  state=await service.calculationConfirm({sessionId:'case-a',revision:rev,reviewId:state.calculation.reviewId},'user')
  state=await service.prepare({sessionId:'case-a'});assert.equal(state.calculation.preparation.profileId,TOPOLOGY_CONTRACT.id)
  assert.equal(state.calculation.preparation.calculationReady,true)
  service.calculations.beginTurn('case-a',{prompt:'开始计算'})
  await assert.rejects(service.calculate({sessionId:'case-a',preparationId:state.calculation.preparation.id}),/页面入口/)
  const detail=await service.calculationGet({sessionId:'case-a',runId:run.runId,detail:true},'user')
  assert.equal(detail.historical,true);assert.equal(detail.preparation.topology.rows.length,1)
  assert.deepEqual(detail.preparation.native.header,[[1,31,1,0]])
  const p=topology([[10,8],[10,8]],'parallel')
  state=await service.calculationUpdateDraft({sessionId:'case-a',revision:state.calculation.revision,topology:p},'user')
  await service.calculationConfirm({sessionId:'case-a',revision:state.calculation.revision,reviewId:state.calculation.reviewId},'user')
  state=await service.prepare({sessionId:'case-a'});assert.ok(state.calculation.preparation.native);assert.equal(state.calculation.preparation.calculationReady,false)
  assert.ok(state.calculation.blockers.some(b=>b.code==='dll_parallel_distribution_unverified'))
})

test('actual tool schema and execution enforce single row; max topology remains readable within output budget',async t=>{
  const {service}=await fixture(t,fakeProcess),tools=new Map()
  installTools({tools:{register:tool=>tools.set(tool.name,tool)}},service)
  const update=tools.get('mche_calculation_update_draft'),exec={agent:{id:'case-a'}}
  assert.equal(update.parameters.properties.topology.properties.rows.maxItems,1)
  assert.match(update.parameters.properties.revision.description,/calculation.revision/)
  let result=JSON.parse(await update.execute({changes:{},revision:0,topology:topology([[8,5]])},exec))
  assert.notEqual(result.ok,false)
  const current=await service.get({sessionId:'case-a'})
  await service.calculationUpdateDraft({sessionId:'case-a',revision:current.calculation.revision,topology:topology(Array.from({length:5},()=>[10,10,10,10,10,10]))},'user')
  result=JSON.parse(await update.execute({changes:{},revision:current.calculation.revision+1,topology:topology([[8,5]])},exec))
  assert.equal(result.ok,false);assert.match(result.message,/单排/)
  const raw=await tools.get('mche_case_get').execute({},exec)
  assert.ok(Buffer.byteLength(raw)<=32000)
  const read=JSON.parse(raw);assert.equal(read.calculation.topology.rows.length,5);assert.equal(read.calculation.topologyLayout.passes.length,30)
})

test('Worker rejects corrupted ranges, geometry slots, cycles, omitted passes, arbitrary branches and stale profiles before DLL',async()=>{
  const base=await ltrRequest();base.profileDigest=PROFILE_DIGEST;base.profileId=CONTRACT.id
  const valid=[base]
  for(const top of [topology(),topology([[12,8],[9,6]]),topology([[12,8],[12,8]],'parallel'),topology([[12,8],[12,8]],'series',['r1p1','r2p1','r2p2','r1p2'])]) {
    valid.push(applyTopology({...structuredClone(base),profileId:TOPOLOGY_CONTRACT.id,profileDigest:TOPOLOGY_DIGEST},top))
  }
  const invalid=[]
  for(const change of [r=>r.general[1]=6,r=>r.general[9]=1,r=>r.tube[15]=99,r=>r.tube[16]=0,r=>r.header[1][0]=1,
    r=>r.header[0][2]=0,r=>r.header[2][3]=0,r=>r.header[0][1]=501,r=>r.connection[0][1]=0,r=>r.connection.pop(),
    r=>r.connection[2][1]=1,r=>r.connection[1][1]=1,r=>r.profileDigest='stale',r=>r.tube[69]=1]) {
    const r=structuredClone(valid[2]);change(r);invalid.push(r)
  }
  const code="import sys,json; sys.path.insert(0,sys.argv[1]); import worker; data=json.load(sys.stdin); out=[]\nfor req in data:\n try: worker.validate(req); out.append(True)\n except Exception: out.append(False)\nprint(json.dumps(out))"
  const result=spawnSync(join(repo,'.dsh/mche-python-x86/python.exe'),['-E','-B','-X','utf8','-c',code,join(repo,'packages/dsh-mche/src/worker')],{input:JSON.stringify([...valid,...invalid]),encoding:'utf8',windowsHide:true})
  assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),[...valid.map(()=>true),...invalid.map(()=>false)])
})
