import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { McheService } from '../src/service.js'
export const repo = fileURLToPath(new URL('../../../',import.meta.url))
export const value=(value,unit='')=>({value,unit,source:'自动化测试夹具；不是用户工程确认资料'})
export async function fixture(t,process) {
  const root=await mkdtemp(join(tmpdir(),'mche-calculation-'))
  const service=new McheService({root,catalogPath:join(repo,'data/catalogs/flat-tubes.json'),
    calculation:{python:join(repo,'.dsh/mche-python-x86/python.exe'),runtimeRoot:join(repo,'runtime'),process}})
  t.after(async()=>{await service.close();await rm(root,{recursive:true,force:true})})
  return {service,root}
}
export async function select(service,sessionId='case-a',names=['A44S','B01','WATER']) {
  for(const [propose,confirm,name] of [['propose','confirmTube',names[0]],['finPropose','confirmFin',names[1]],['refrigerantPropose','confirmRefrigerant',names[2]]]) {
    const state=await service[propose]({sessionId,name,reason:'自动化测试选型，不是工程验收'})
    await service[confirm]({sessionId,revision:state.revision,proposalId:state.proposals.at(-1).id})
  }
  return service.get({sessionId})
}
export function conditions() {
  return {refPressure:value(100,'kPa'),refTemperature:value(45,'°C'),refMassFlow:value(900,'kg/h'),airPressure:value(101325,'Pa'),
    airTemperature:value(26.7,'°C'),airHumidity:value(50,'%'),airVolumeFlow:value(3046.43,'m3/h'),tubeCount:value(31,'个'),
    finnedLength:value(691.6,'mm'),unfinnedLength:value(0,'mm'),refDirection:value('left'),airDirection:value('left_to_right'),
    portShape:value('rectangular'),finStructure:value('louver'),finHeightBasis:value('heightPostBrazingMm'),finDepthBasis:value('widthMm'),
    louverLengthBasis:value('louverLengthOverallMm'),finPitchBasis:value('pitch'),finConductivity:value(237,'W/(m K)'),
    assemblyEvidence:value('测试：带翅片长度与无翅片总长度分开；装配关系仅用于接口验证'),finUnitEvidence:value('测试：主表 mm / degree，待真实工程确认')}
}
export async function prepared(service,sessionId='case-a') {
  const selected=await select(service,sessionId)
  const g=selected.snapshots[selected.selections.tube.snapshotId].tube.geometry
  // A fabricated, equal-area rectangular port is a TEST INPUT, never an automatic production mapping.
  const changes={...conditions(),portWidth:value(g.flowAreaMm2/g.portHeightMm/g.portCount,'mm')}
  let state=await service.calculationUpdateDraft({sessionId,changes},'user')
  state=await service.calculationConfirm({sessionId,revision:state.calculation.revision,reviewId:state.calculation.reviewId},'user')
  return service.prepare({sessionId})
}
export async function waitRun(service,runId,sessionId='case-a',timeout=15000) {
  const start=Date.now()
  while(Date.now()-start<timeout){const run=await service.calculationGet({sessionId,runId});if(!['queued','running'].includes(run.status))return run;await delay(20)}
  throw new Error('run timeout')
}
export const ltrRequest=async()=>JSON.parse(await readFile(new URL('./fixtures/ltr-request.json',import.meta.url),'utf8'))
