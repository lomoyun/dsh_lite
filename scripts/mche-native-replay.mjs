// Explicit acceptance utility; synthetic supplements never enter a user's case.
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { join, resolve } from 'node:path'
import { NativeProcess } from '../packages/dsh-mche/src/calculation-runner.js'
import { fixture, prepared, waitRun, ltrRequest, repo } from '../packages/dsh-mche/test/calculation-fixture.js'

const reference=process.argv[2]
if(!reference)throw new Error('Usage: node scripts/mche-native-replay.mjs <directory containing independent run_ltr_case.py and mche_driver.py>')
const out=join(repo,'.dsh/calculation-replay-evidence'),clean=[]
await mkdir(out,{recursive:true})
const python=join(repo,'.dsh/mche-python-x86/python.exe'),runtime=join(repo,'runtime')
async function compare(label,request,worker){
  const file=join(out,label+'-request.json');await writeFile(file,JSON.stringify(request,null,2))
  const result=await new Promise((done,reject)=>{
    const child=spawn(python,['-E','-B','-X','utf8',join(repo,'packages/dsh-mche/test/fixtures/native-reference.py'),resolve(reference),file,runtime],{cwd:runtime,windowsHide:true,stdio:['ignore','pipe','pipe']})
    let output='',error='';const timer=setTimeout(()=>child.kill(),30000)
    child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>error+=chunk)
    child.on('error',e=>{clearTimeout(timer);reject(e)})
    child.on('close',code=>{clearTimeout(timer);if(code!==0)reject(new Error(error||`Reference exit ${code}`));else {try{done(JSON.parse(output))}catch(e){reject(e)}}})
  })
  assert.equal(result.rawResult.length,64)
  const differences=[]
  for(let i=0;i<64;i++){
    const a=worker.result.rawResult[i],b=result.rawResult[i]
    if(typeof a==='number'&&typeof b==='number'){
      if(Math.abs(a-b)>Math.max(1e-10,Math.abs(b)*1e-10))differences.push({index:i,worker:a,reference:b})
    }else if(JSON.stringify(a)!==JSON.stringify(b))differences.push({index:i,worker:a,reference:b})
  }
  await writeFile(join(out,label+'-comparison.json'),JSON.stringify({label,engineeringAcceptance:false,worker,independent:result,differences},null,2))
  assert.deepEqual(differences,[])
  return {label,status:worker.status,rawSlots:64,matchedSlots:64,nonFinite:result.rawResult.flatMap((v,i)=>typeof v==='object'?[i]:[]),actual:worker.result.actual}
}
try {
  const native=new NativeProcess({python,runtimeRoot:runtime,timeoutMs:30000}),request=await ltrRequest()
  const ltr=await compare('ltr',request,await native.start({runId:'ltr-independent-check',request}).promise)
  const {service}=await fixture({after:fn=>clean.push(fn)}),state=await prepared(service)
  const run=await service.calculate({sessionId:'case-a',preparationId:state.calculation.preparation.id,requestId:'synthetic-replay'},'user')
  await waitRun(service,run.runId)
  const detail=await service.calculationGet({sessionId:'case-a',runId:run.runId,detail:true},'user')
  await writeFile(join(out,'catalog-run.json'),JSON.stringify(detail,null,2))
  const catalog=await compare('catalog-synthetic',detail.preparation.native,detail)
  const sources={}
  for(const name of ['run_ltr_case.py','mche_driver.py'])sources[name]=createHash('sha256').update(await readFile(join(reference,name))).digest('hex')
  const summary={createdAt:new Date().toISOString(),sources,ltr,catalog,note:'Current catalog A44S/B01/WATER with explicitly fabricated equal-area rectangular port and test conditions. Not user engineering confirmation.'}
  await writeFile(join(out,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2))
}finally{for(const fn of clean)await fn()}
