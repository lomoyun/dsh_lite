// Local UI acceptance fixture. All supplied engineering values are synthetic test data.
import { writeFile } from 'node:fs/promises'
import { nativeFixture, post } from '../packages/dsh-excel-understanding/test/native-fixture.js'
import { mockCalculationResponse } from '../packages/dsh-mche/test/calculation-model-fixture.js'
import { conditions, value } from '../packages/dsh-mche/test/calculation-fixture.js'

const cleanup=[]
const f=await nativeFixture({after:fn=>cleanup.push(fn)},false,{respond:mockCalculationResponse})
try {
  const {sessionId}=await post(f,'/api/chat',{prompt:'计算验收初始化（仅为本地界面测试）'})
  const request=(path,args={})=>post(f,'/api/mche/'+path,{sessionId,...args})
  for(const [propose,confirm,name] of [['propose','confirm-tube','A44S'],['fin-propose','confirm-fin','B01'],['refrigerant-propose','confirm-refrigerant','WATER']]){
    const state=await request(propose,{name,reason:'界面测试夹具；不是工程验收'})
    await request(confirm,{revision:state.revision,proposalId:state.proposals.at(-1).id})
  }
  const state=await request('case'),g=state.snapshots[state.selections.tube.snapshotId].tube.geometry
  await request('calculation-draft',{changes:{...conditions(),portWidth:value(g.flowAreaMm2/g.portHeightMm/g.portCount,'mm')}})
  const record={base:f.base,home:f.home,sessionId,pid:process.pid,engineeringAcceptance:false}
  await writeFile('.dsh/calculation-ui-state.json',JSON.stringify(record,null,2))
  console.log('仅供界面验收的隔离工作区，合成工程草稿尚未确认；Ctrl+C关闭。')
  console.log(JSON.stringify(record,null,2))
  process.on('SIGINT',async()=>{for(const fn of cleanup)await fn();process.exit(0)})
}catch(error){for(const fn of cleanup)await fn();throw error}
