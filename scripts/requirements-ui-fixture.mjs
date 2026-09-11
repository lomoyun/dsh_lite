// Isolated browser acceptance workspace; local deterministic model, no external requests.
import { readFile, writeFile } from 'node:fs/promises'
import { nativeFixture, post } from '../packages/dsh-excel-understanding/test/native-fixture.js'
import { mockRequirementsResponse } from '../packages/dsh-mche/test/requirements-model-fixture.js'

const cleanup=[]
const f=await nativeFixture({after:fn=>cleanup.push(fn)},false,{respond:mockRequirementsResponse})
try {
  const {sessionId}=await post(f,'/api/session/prepare',{})
  const bytes=await readFile(new URL('../答复_/3-冷凝器客户输入.xls',import.meta.url))
  const response=await fetch(f.base+'/api/excel/upload',{method:'POST',body:bytes,headers:{'Content-Type':'application/octet-stream','X-File-Name':'customer-requirements.xls','X-Session-Id':sessionId}})
  if(!response.ok)throw new Error(await response.text())
  const {file}=await response.json()
  await post(f,'/api/chat',{sessionId,prompt:'需求表验收：读取客户需求并给出Boundary建议。',workbooks:[file]})
  const record={base:f.base,home:f.home,sessionId,fileId:file.fileId,pid:process.pid,engineeringAcceptance:false}
  await writeFile('.dsh/requirements-ui-state.json',JSON.stringify(record,null,2))
  console.log(JSON.stringify(record,null,2))
  process.on('SIGINT',async()=>{for(const fn of cleanup)await fn();process.exit(0)})
} catch(error) {for(const fn of cleanup)await fn();throw error}
