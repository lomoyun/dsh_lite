import { randomUUID } from 'node:crypto'
import { CALCULATION_FIELDS, calculationChanges } from './calculation-fields.js'
import { CONTRACT, TOPOLOGY_CONTRACT, inputDigest, mapCalculation, emptyCalculation } from './calculation-mapper.js'
import { projectTopology, normalizeTopology } from './calculation-topology.js'
import { conflict, McheError, object, text, pagination } from './validation.js'
import { CalculationRuns, NativeProcess, runSummary } from './calculation-runner.js'
import { PTM_KEYS } from './requirements-fields.js'
import { CONDENSER_MAPPING } from './requirements-mapping.js'

// Authorization is created by the chat host from the raw prompt, before plugin/attachment notices.
// Deliberately bounded imperative grammar: a quoted/example/question/negative request grants nothing.
export function explicitCalculation(prompt) {
  if(typeof prompt!=='string') return false
  const plain=prompt.replace(/```[\s\S]*?```/g,'').replace(/^\s*>.*$/gm,'').replace(/`[^`]*`|“[^”]*”|「[^」]*」|"[^"\n]*"|'[^'\n]*'/g,'').trim()
  if(/[?？]|不要|别计算|不计算|勿计算|禁止|示例|例如|假设|引用/.test(plain)) return false
  return /^(?:(?:参数|输入|工程核对)(?:已确认|已经确认)[，,。]\s*)?(?:请|现在|立即|帮我|请帮我)?\s*(?:开始计算|执行计算|运行计算|计算当前方案|计算已确认方案|按已确认参数计算|开始本次计算|修改参数并计算|calculate(?: the current case)?|run (?:the )?calculation)\s*[。！!.]?\s*$/i.test(plain)
}

export class CalculationService {
  constructor(owner, { root, python, runtimeRoot, timeoutMs, process } = {}) {
    this.owner=owner;this.turns=new Map()
    this.process=process??new NativeProcess({python,runtimeRoot,timeoutMs})
    this.runs=new CalculationRuns({root,process:this.process})
  }
  beginTurn(sessionId,{prompt,message,requestId=randomUUID(),intent='chat'}) {
    this.turns.set(sessionId,{allowed:intent==='chat'&&explicitCalculation(prompt),requestId,
      trigger:{kind:'dialogue',prompt,userMessage:structuredClone(message),receivedAt:new Date().toISOString()}})
  }
  endTurn(sessionId) {this.turns.delete(sessionId)}
  async view(state) {
    const mapped=mapCalculation(state),records=await this.runs.list(state.sessionId)
    const stored=state.calculation?.preparation
    const requirements = this.owner.requirements.view(state)
    return {...(state.calculation??emptyCalculation()),fields:CALCULATION_FIELDS,
      topology: mapped.topology, topologyStored: Boolean(state.calculation?.topology), topologyLayout: mapped.topologyLayout,
      profileDraft: state.requirements?.document ? requirements.profileDraft : null,
      profile:{id:mapped.profileId,digest:mapped.profileDigest,supported:mapped.profileId===CONTRACT.id?CONTRACT.supported:{...CONTRACT.supported,banks:5,passesPerBank:6},fluidBindings:CONTRACT.fluidBindings,
        engineeringVerified:false,parallelDistributionVerified:TOPOLOGY_CONTRACT.parallelDistributionVerified,
        mapping: { id: CONDENSER_MAPPING.id, version: CONDENSER_MAPPING.version, rulesDigest: requirements.rulesDigest }},
      reviewId:mapped.fingerprint,confirmed:mapped.confirmed,blockers:mapped.blockers,provenance:mapped.provenance,warnings:mapped.warnings,
      preparation:stored?{...stored,stale:stored.fingerprint!==mapped.fingerprint,
        calculationReady:stored.fingerprint===mapped.fingerprint&&mapped.confirmed&&stored.calculationReady}:null,
      runs:records.slice(0,50).map(r=>runSummary(r,mapped.fingerprint)),runCount:records.length}
  }
  async profile(input) {
    object(input,['sessionId'])
    const state=await this.owner.requirements.checkedState(await this.owner.store.view(input.sessionId))
    const current = await this.owner.decorate(state)
    return { ...current.calculation, guidance: current.guidance, recommendationContext: current.recommendationContext, runtime:await this.process.probe() }
  }
  async update(input,origin='agent') {
    object(input,['sessionId','changes','revision','topology'])
    const changes=calculationChanges(input.changes??{},origin)
    const topology=input.topology===undefined?undefined:normalizeTopology(input.topology,origin)
    const state=await this.owner.store.update(input.sessionId,{},state=>{
      const calc=state.calculation
      if(origin!=='user'&&(projectTopology(calc).rows.length>1||topology?.rows.length>1))throw new McheError('对话只允许修改单排方案；已有多排方案请在计算工况页修改，不得静默降为单排',403)
      if(topology && !Number.isSafeInteger(input.revision))throw conflict('结构保存必须提供 calculation.revision')
      if((calc.topology||topology)&&['tubeCount','refDirection'].some(k=>Object.hasOwn(changes,k)&&changes[k]!==null))throw new McheError('管数和冷媒方向已由结构统一管理，请修改 topology')
      if(state.requirements?.document && Object.keys(changes).some(key=>PTM_KEYS.includes(key))) throw new McheError('当前工况来自客户需求，请在客户需求页修改并确认 Boundary；结构及工程补充仍在此填写')
      if(input.revision!==undefined&&input.revision!==calc.revision) throw conflict('计算输入已更新，请重新核对')
      const changed=Object.keys(changes).filter(k=>JSON.stringify(calc.draft[k]??null)!==JSON.stringify(changes[k]))
      const topologyChanged=topology && JSON.stringify(topology)!==JSON.stringify(calc.topology)
      if(!changed.length&&!topologyChanged)return
      for(const k of changed) {if(changes[k]===null)delete calc.draft[k];else calc.draft[k]=changes[k]}
      if(topologyChanged){calc.topology=topology;delete calc.draft.tubeCount;delete calc.draft.refDirection}
      calc.revision++;calc.confirmation=null
    })
    return this.owner.decorate(state)
  }
  async confirm(input,origin) {
    if(origin!=='user')throw new McheError('计算输入只能由用户在工程核对页确认',403)
    object(input,['sessionId','revision','reviewId'])
    const state=await this.owner.store.update(input.sessionId,{},state=>{
      const calc=state.calculation,fingerprint=inputDigest(state)
      if(input.revision!==calc.revision||input.reviewId!==fingerprint||calc.confirmation?.digest===fingerprint)throw conflict('计算核对已过期或已确认')
      calc.confirmation={id:randomUUID(),digest:fingerprint,confirmedAt:new Date().toISOString(),confirmedBy:'user',
        profileDigest:mapCalculation(state).profileDigest,topology:projectTopology(calc),snapshotIds:Object.fromEntries(Object.entries(state.selections).map(([k,s])=>[k,s?.snapshotId??null])),inputs:structuredClone(calc.draft)}
    })
    return this.owner.decorate(state)
  }
  async prepareState(state,runtime) {
    const mapped=mapCalculation(await this.owner.requirements.checkedState(state)),previous=state.calculation.preparation
    state.calculation.preparation={...mapped,id:previous?.fingerprint===mapped.fingerprint?previous.id:randomUUID(),
      createdAt:previous?.fingerprint===mapped.fingerprint?previous.createdAt:new Date().toISOString(),
      runtime,confirmation:state.calculation.confirmation,confirmedInputs:structuredClone(state.calculation.draft),
      boundary:structuredClone(state.calculation.boundary??null),requirementsSnapshot:structuredClone(state.calculation.requirementsSnapshot??null),
      blockers:[...mapped.blockers,...(runtime.ready?[]:[{code:'runtime_unavailable',message:runtime.error??'运行环境不可用'}])],
      calculationReady:mapped.confirmed&&mapped.mappingReady&&!mapped.blockers.length&&runtime.ready}
  }
  async calculate(input,origin='agent') {
    object(input,origin==='user'?['sessionId','preparationId','requestId']:['sessionId','preparationId'])
    text(input.preparationId,100)
    let trigger,requestId
    if(origin==='user') {text(input.requestId,100);requestId='button:'+input.requestId;trigger={kind:'button',requestId:input.requestId,receivedAt:new Date().toISOString()}}
    else {const turn=this.turns.get(input.sessionId);if(!turn?.allowed)throw new McheError('本轮没有明确的用户计算指令；附件、引用和插件提示不能授权执行',403);trigger=turn.trigger;requestId='dialogue:'+turn.requestId}
    let run,currentFingerprint
    await this.owner.store.update(input.sessionId,{},async state=>{
      const prep=state.calculation.preparation,mapped=mapCalculation(await this.owner.requirements.checkedState(state))
      currentFingerprint=mapped.fingerprint
      if(origin!=='user'&&mapped.topology.rows.length>1)throw new McheError('多排执行只能由页面入口触发，对话可读取和解释',403)
      // A lost response can be retried after the user edits the case. Returning the
      // already persisted run does not authorize another execution of stale input.
      const retried=(await this.runs.list(input.sessionId)).find(r=>r.requestIds.includes(requestId))
      if(retried){
        if(retried.preparation.id!==input.preparationId)throw conflict('触发标识已用于其他参数包')
        run=retried;return
      }
      if(!prep||prep.id!==input.preparationId||prep.fingerprint!==mapped.fingerprint)throw conflict('参数包已过期，请重新准备当前已确认输入')
      if(!prep.calculationReady||!mapped.confirmed||!mapped.mappingReady||mapped.blockers.length)throw conflict('计算尚未就绪，请先核对并确认工况与工程补充')
      // Native environment is revalidated in the isolated process immediately before every call.
      run=await this.runs.enqueue(input.sessionId,prep,trigger,requestId,
        Object.fromEntries(Object.entries(prep.snapshotIds).map(([k,id])=>[k,state.snapshots[id]])))
    })
    return runSummary(run,currentFingerprint)
  }
  async get(input,origin='agent') {
    object(input,origin==='user'?['sessionId','runId','detail','offset','limit']:['sessionId','runId','offset','limit'])
    const state=await this.owner.store.view(input.sessionId),fingerprint=inputDigest(state)
    if(!input.runId){const {offset,limit}=pagination(input),records=await this.runs.list(input.sessionId);return {
      runs:records.slice(offset,offset+limit).map(r=>runSummary(r,fingerprint)),runCount:records.length,
      nextOffset:offset+limit<records.length?offset+limit:null}}
    await this.runs.initialize();await this.runs.lock
    const record=await this.runs.read(input.sessionId,input.runId)
    return input.detail===true?{...record,...runSummary(record,fingerprint)}:runSummary(record,fingerprint)
  }
  async cancel(input) {
    object(input,['sessionId','runId'])
    const state=await this.owner.store.view(input.sessionId)
    return runSummary(await this.runs.cancel(input.sessionId,input.runId),inputDigest(state))
  }
}
