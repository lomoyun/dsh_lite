import { element, button, message, table, issues, numberText, disclosure, primaryAction } from './mche-elements.js'
import { createFlowTopologyEditor } from './flow-topology.js'

const statuses = { queued:'排队中',running:'计算中',succeeded:'成功',failed:'失败',cancelled:'已取消',timed_out:'超时',interrupted:'已中断' }
const rawView = (title, value) => { const d=element('details');d.append(element('summary',title),element('pre',JSON.stringify(value,null,2),'detail-text'));return d }
function unavailable(button, condition) { button.dataset.unavailable=String(condition);button.disabled=condition;return button }
function readButton(label, action) { const node=button(label,action);node.dataset.readOnly='true';return node }
function sourceText(source) { const value=source?.source??source?.rule??source?.kind??source;return typeof value==='object'?JSON.stringify(value):value??'目录确认快照' }

export function calculationInputsPane(state, actions, group, presentation) {
  const section=element('section'),calc=state.calculation,controls=new Map()
  const flow = group === 'conditions' ? createFlowTopologyEditor(calc, actions, presentation) : null
  const fromRequirements = Boolean(state.requirements?.document)
  section.append(element('h3',group==='conditions'?'工况与结构':'工程核对'),
    message(fromRequirements ? 'Boundary 工况由客户需求页统一填写和确认。本页补充结构、长度、方向及工程依据。' : '冷媒入口压力 / 温度 / 质量流量，空气状态及体积流量。工况不预填，压力必须是绝对压力。'))
  if (fromRequirements && group === 'conditions') {
    const entries = Object.entries(calc.boundary?.inputs ?? {})
    const applied = element('div')
    applied.append(table(['已应用的 Boundary 输入', '值', '单位', '来源'], entries.map(([key, value]) => [state.requirements.fields[key].label, value.value, value.unit, value.source])),
      rawView('完整已应用快照、映射与派生依据', { boundary: calc.boundary, profile: calc.profileDraft, snapshot: calc.requirementsSnapshot }))
    section.append(message(entries.length ? `已应用快照 · ${entries.length} 项工况 · ${entries.slice(0, 3).map(([key, value]) => `${state.requirements.fields[key].label} ${value.value} ${value.unit}`).join(' · ')}` : '尚无已应用的需求工况快照'),
      message(state.requirements.reviewed ? '需求已核对；仍需结构补填及工程确认。' : '需求草稿有未确认变更，请核对差异并应用。'),
      disclosure('查看已应用工况与来源', applied, 'applied-boundary'),
      readButton('查看 / 编辑客户需求', () => actions.navigate({ view: 'requirements' })))
  }
  if (flow) section.append(flow.root)
  const pending = element('div'), completed = element('div')
  const fields=Object.entries(calc.fields).filter(([key,f])=>f.group===group && !['tubeCount','refDirection'].includes(key) && !(fromRequirements && state.requirements.fields[key]?.boundary))
  fields.forEach(([key,f])=>{
    const old=calc.draft[key],value=element(f.options?'select':f.text?'textarea':'input'),unit=element('select'),source=element('textarea')
    if(f.options){value.add(new Option('请核对选择',''));for(const [v,label] of Object.entries(f.options)) {
      const choice = state.guidance?.semanticChoices?.find(c => c.field === key)?.options.find(o => o.value === v)
      value.add(new Option(choice?.original ? `${label} · 原值 ${choice.original.value ?? '未知'} ${choice.original.unit}` : label,v))
    }}
    value.value=old?.value??'';value.setAttribute('aria-label',f.label);value.maxLength=f.text?2000:80
    const projection = calc.provenance.find(p => p.field === key && p.source?.kind === 'catalog')
    if (projection?.adopted?.value != null && !old) value.placeholder = `沿用目录 ${projection.original.value} ${projection.original.unit}`
    source.value=old?.source??'';source.setAttribute('aria-label',`${f.label}依据`);source.maxLength=1200
    if(!f.text&&!f.options)value.inputMode='decimal'
    for(const u of f.units?Object.keys(f.units):[''])unit.add(new Option(u||'原文',u))
    unit.value=old?.unit??f.unit;unit.setAttribute('aria-label',`${f.label}单位`)
    for(const node of [value,unit,source]){node.addEventListener('input',()=>actions.dirty(true));node.addEventListener('change',()=>actions.dirty(true))}
    if(key==='airDirection'&&flow)value.addEventListener('change',()=>flow.setAirDirection(value.value))
    controls.set(key,{value,unit,source,f})
    const row = element('div', '', 'mche-field'); row.dataset.field = key
    const evidence = disclosure('依据', source)
    row.append(element('label', f.label+(f.required?' *':'（补充）')), value, unit, evidence)
    const problems = calc.blockers.filter(p => p.field === key)
    if (problems.length) row.append(issues('待核', problems))
    const needsReview = problems.length || f.options && !old || f.required && !old && projection?.adopted?.value == null
    ;(group !== 'engineering' || needsReview ? pending : completed).append(row)
  })
  if(group==='engineering')section.append(message('原表保留不变。先核对孔型和翅片字段的含义；需要采用补充值时填写具体来源。净间距与节距采用不同 FPI 换算。'))
  section.append(pending)
  if (completed.childElementCount) section.append(disclosure(`${calc.confirmed ? '已确认输入' : '已填与其他补充输入'}（${completed.childElementCount}）`, completed, 'engineering-completed'))
  section.append(primaryAction(button('保存计算草稿',()=>actions.run(async()=>{
    const changes={}
    for(const [key,{value,unit,source,f}] of controls){
      const old=calc.draft[key],raw=value.value.trim(),basis=source.value.trim()
      if(String(old?.value??'')===raw&&(old?.unit??f.unit)===unit.value&&(old?.source??'')===basis)continue
      if(raw&&!basis)throw new Error(`请填写${f.label}的依据或用户原文`)
      changes[key]=raw?{value:f.options||f.text?raw:Number(raw),unit:unit.value,source:basis}:null
    }
    if(!Object.keys(changes).length&&!flow?.dirty){actions.dirty(false);return state}
    const result=await actions.request('calculation-draft',{revision:calc.revision,changes,...(flow?.dirty?{topology:flow.value}:{})});actions.dirty(false);return result
  }))))
  if(group==='engineering') {
    const sources = element('div')
    sources.append(element('h4','本次结构'),table(['排 / 流程','管数','全局管号','方向'],calc.topologyLayout.passes.map(p=>[
      `${p.rowIndex+1} / ${p.passIndex+1}`,p.tubeCount??'待填',p.startTube===null?'待填':`${p.startTube}–${p.endTube}`,p.direction==='left'?'左进右出':p.direction==='right'?'右进左出':'待填',
    ])),message(`${calc.topology.connection==='series'?'串联':'排间并联'} · 顺序 ${calc.topology.order.join(' → ')} · 依据：${calc.topology.source||'待填'}`))
    sources.append(element('h4','原表 → 计算采用值 → 换算 → 依据'), table(['参数','原表 / 原始输入','采用值','换算 / 依据'],calc.provenance.map(p=>[
      calc.fields[p.field]?.label??p.field,
      `${p.original?.value??'缺项'} ${p.original?.unit??''} ${p.original?.evidence?.cell??''} ${p.original?.evidence?.display??''}`,
      `${numberText(p.adopted?.value)} ${p.adopted?.unit??''}`,
      `${JSON.stringify(p.conversion??{})} · ${sourceText(p.source)}`,
    ])),element('h4','本次待确认工况及工程补充'),table(['参数','值','单位','依据'],Object.entries(calc.draft).map(([key,v])=>[calc.fields[key].label,v.value,v.unit,v.source])),
    message(calc.confirmed?'当前输入及工程依据已由用户确认。':'请同时核对工况、目录来源和工程补充；更换相关部件或修改参数后需要重新确认。'))
    section.append(disclosure('完整来源对照与换算过程', sources, 'engineering-provenance'),
      message(calc.confirmed ? '当前工程输入已确认。' : '当前工程输入待确认；完整来源可展开核对。'),
      primaryAction(unavailable(button('确认计算输入与工程核对',()=>actions.mutate('calculation-confirm',{revision:calc.revision,reviewId:calc.reviewId})),calc.confirmed||!Object.keys(calc.draft).length)))
    if (!Object.keys(calc.draft).length) section.append(message('请先保存计算草稿，再确认工程核对。'))
  }
  return section
}

export function nativePreparationPane(state,actions) {
  const section=element('section'),calc=state.calculation,prep=calc.preparation
  section.append(element('h3','实际计算参数准备'),primaryAction(button('准备计算参数',()=>actions.mutate('prepare',{},'preparation'))))
  if(!prep){section.append(issues('计算阻塞项',calc.blockers));return section}
  section.append(message(`参数包 ${prep.id} · ${prep.stale?'已过期':prep.calculationReady?'可计算':'尚未就绪'}`),
    disclosure('运行环境与技术限制', message(`工程验证未通过：当前 DLL 第42/43槽 NaN 尚待修复。参数就绪仅表示可以发起受控调用。${prep.runtime.ready ? 'x86 环境已通过准备检查；执行前再次检查。' : `运行环境不可用：${prep.runtime.error}`}`), 'runtime-details'),
    issues('原生计算阻塞项',prep.stale?calc.blockers:prep.blockers))
  const lastRun=calc.runs.find(run=>run.preparationId===prep.id)
  const repeat=lastRun&&!['queued','running'].includes(lastRun.status)
  section.append(primaryAction(unavailable(button(repeat?'重新计算':'开始计算',()=>actions.run(async()=>{
    const key=`mche-trigger:${state.sessionId}:${prep.id}`
    let requestId=repeat?null:sessionStorage.getItem(key)
    if(!requestId){requestId=crypto.randomUUID();sessionStorage.setItem(key,requestId)}
    await actions.request('calculate',{preparationId:prep.id,requestId})
    return actions.request('case')
  })),!prep.calculationReady || prep.stale)),message('任务保存在当前会话，可在“结果”查看、取消或刷新恢复。重试同次请求返回同一任务；结束后“重新计算”创建新任务。'))
  if(prep.native)section.append(rawView('查看完整原生入参与版本',prep.native))
  section.append(rawView('查看逐字段来源及确认记录',{provenance:prep.provenance,confirmation:prep.confirmation,snapshotIds:prep.snapshotIds,boundary:prep.boundary,requirementsSnapshot:prep.requirementsSnapshot}))
  return section
}

const resultFields = [
  ['heatLoadW','换热量','kW',v=>v/1000],['refrigerantMassFlowKgS','冷媒质量流量','kg/h',v=>v*3600],
  ['airPressureDropPa','空气压降','Pa',v=>v],['refrigerantPressureDropPa','冷媒压降','kPa',v=>v/1000],
  ['airOutletTemperatureK','空气出口温度','°C',v=>v-273.15],['airOutletHumidityPercent','空气出口相对湿度','%',v=>v],
  ['refrigerantOutletPressurePa','冷媒出口绝对压力','kPa',v=>v/1000],['refrigerantOutletTemperatureK','冷媒出口温度','°C',v=>v-273.15],
]
export function calculationResultsPane(state,actions,selectedRunId,linkedRun) {
  const section=element('section'),loaded=state.calculation.runs
  const runs=linkedRun && !loaded.some(run => run.runId === linkedRun.runId) ? [...loaded, linkedRun] : loaded
  section.append(element('h3','计算结果'),primaryAction(readButton('刷新计算状态',()=>actions.run(()=>actions.request('case')))))
  const history = element('div')
  if(!runs.length)section.append(message('暂无计算任务。先核对工程输入并准备参数。'))
  for(const run of runs){
    const card=element('article','','mche-run');card.dataset.recordId=run.runId;if(run.runId===selectedRunId)card.dataset.selected='true'
    card.append(element('h4',`${statuses[run.status]??run.status} · ${run.historical?'历史方案结果':'当前方案'}`),
      message(`${run.runId} · ${run.createdAt}${run.elapsedMs!==undefined?` · 耗时 ${(run.elapsedMs/1000).toFixed(2)} 秒`:''}`))
    if(run.error)card.append(message(run.error))
    if(run.status==='succeeded')card.append(table(['结果','数值','单位'],resultFields.map(([key,label,unit,convert])=>[label,Number.isFinite(run.actual?.[key])?numberText(convert(run.actual[key])):'未返回',unit])))
    if(['queued','running'].includes(run.status))card.append(button('取消本次计算',()=>actions.run(async()=>{await actions.request('calculation-cancel',{runId:run.runId});return actions.request('case')})))
    const detail=element('div')
    card.append(readButton('查看本次完整输入及原始结果',()=>actions.run(async()=>{
      const full=await actions.request('calculation-get',{runId:run.runId,detail:true})
      detail.replaceChildren(rawView('确认输入、快照和原生入参', {preparation:full.preparation,snapshots:full.snapshots,triggers:full.triggers}),
        rawView('原始输出、环境、错误和日志',{result:full.result,environment:full.environment,error:full.error,events:full.events,logs:full.logs,exitCode:full.exitCode}))
      return null
    })),detail)
    if (run.runId === selectedRunId || !selectedRunId && run === runs[0] || ['queued','running'].includes(run.status)) section.append(card)
    else history.append(disclosure(`${statuses[run.status] ?? run.status} · ${run.createdAt}`, card, run.runId))
  }
  if (history.childElementCount) section.append(disclosure(`历史任务（${history.childElementCount}）`, history, 'run-history'))
  if(loaded.length<state.calculation.runCount)section.append(readButton('查看更早计算',()=>actions.run(async()=>{
    const page=await actions.request('calculation-get',{offset:loaded.length,limit:20})
    return {...state,calculation:{...state.calculation,runs:[...loaded,...page.runs],runCount:page.runCount}}
  })))
  return section
}
