// Synthetic diagnostics only. No user scheme is changed and non-finite outputs remain failures.
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { join, resolve } from 'node:path'
import { NativeProcess } from '../packages/dsh-mche/src/calculation-runner.js'
import { CONTRACT, PROFILE_DIGEST, TOPOLOGY_CONTRACT, TOPOLOGY_DIGEST, MAPPER_DIGEST } from '../packages/dsh-mche/src/calculation-mapper.js'
import { applyTopology } from '../packages/dsh-mche/src/calculation-topology.js'
import { topology } from '../packages/dsh-mche/test/topology-fixture.js'
const reference=resolve(process.argv[2]??'E:/projects_related_files/微通道'),repo=resolve('.'),out=join(repo,'docs/verification/evidence/flow-topology/native')
await mkdir(out,{recursive:true})
const python=join(repo,'.dsh/mche-python-x86/python.exe'),runtime=join(repo,'runtime')
const native=new NativeProcess({python,runtimeRoot:runtime,timeoutMs:30000})
const base=JSON.parse(await readFile('packages/dsh-mche/test/fixtures/ltr-request.json','utf8'))
base.profileId=CONTRACT.id;base.profileDigest=PROFILE_DIGEST
const cases=[['single-regression',null],['single-two-pass',topology([[20,11]])],['two-row-series',topology([[20,11],[20,11]])],
  ['two-row-alternating',topology([[20,11],[20,11]],'series',['r1p1','r2p1','r2p2','r1p2'])],
  ['unequal-row-series',topology([[20,11],[18,10]])],['two-row-parallel',topology([[20,11],[18,10]],'parallel')]]
const summary=[]
for(const [name,top] of cases){
  const request=top?applyTopology({...structuredClone(base),profileId:TOPOLOGY_CONTRACT.id,profileDigest:TOPOLOGY_DIGEST},top):structuredClone(base)
  const file=join(out,name+'-request.json');await writeFile(file,JSON.stringify(request,null,2))
  const started=Date.now(),worker=await native.start({runId:'topology-replay-'+name,request}).promise
  const independent=await new Promise((done)=>{
    const start=Date.now(),child=spawn(python,['-E','-B','-X','utf8',join(repo,'packages/dsh-mche/test/fixtures/native-reference.py'),reference,file,runtime],{cwd:runtime,windowsHide:true,stdio:['ignore','pipe','pipe']})
    let stdout='',stderr='',timedOut=false;const timer=setTimeout(()=>{timedOut=true;child.kill()},30000)
    child.stdout.on('data',v=>stdout+=v);child.stderr.on('data',v=>stderr+=v)
    child.on('error',e=>{clearTimeout(timer);done({error:e.message,elapsedMs:Date.now()-start})})
    child.on('close',code=>{clearTimeout(timer);let parsed;try{parsed=JSON.parse(stdout)}catch{}done({exitCode:code,timedOut,elapsedMs:Date.now()-start,stdout,stderr,...parsed})})
  })
  const differences=[]
  if(worker.result?.rawResult?.length===64&&independent.rawResult?.length===64){
    worker.result.rawResult.forEach((a,i)=>{const b=independent.rawResult[i]
      if(typeof a==='number'&&typeof b==='number'?Math.abs(a-b)>Math.max(1e-10,Math.abs(b)*1e-10):JSON.stringify(a)!==JSON.stringify(b))differences.push({index:i,worker:a,independent:b})})
  }else differences.push({error:'Missing complete 64-slot output from one or both callers'})
  const nonFinite=worker.result?.rawResult?.flatMap((v,i)=>typeof v==='object'?[i]:[])??[]
  if(nonFinite.length)assert.notEqual(worker.status,'succeeded')
  await writeFile(join(out,name+'-comparison.json'),JSON.stringify({name,synthetic:true,engineeringVerified:false,topology:top,request,
    mapperDigest:MAPPER_DIGEST,elapsedMs:Date.now()-started,worker,independent,differences},null,2))
  const record={name,status:worker.status,elapsedMs:worker.result?.elapsedMs,matchedSlots:differences.length===0?64:null,nonFinite,error:worker.error??worker.result?.error,differences}
  summary.push(record);console.log(JSON.stringify(record))
}
const sources={}
for(const name of ['run_ltr_case.py','mche_driver.py'])sources[name]=createHash('sha256').update(await readFile(join(reference,name))).digest('hex')
await writeFile(join(out,'summary.json'),JSON.stringify({createdAt:new Date().toISOString(),engineeringVerified:false,synthetic:true,sources,summary},null,2))
assert.ok(summary.every(r=>r.differences.length===0),'One or more independent replays differ or did not return complete outputs; see evidence')
