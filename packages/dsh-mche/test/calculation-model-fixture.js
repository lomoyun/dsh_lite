// Deterministic model for DSH/browser protocol verification; the worker remains the real x86 DLL.
export function mockCalculationResponse(body) {
  const messages=body.messages??[],index=messages.findLastIndex(m=>m.role==='user'),message=messages[index]
  const prompt=typeof message?.content==='string'?message.content:JSON.stringify(message?.content??'')
  if(!/计算验收|开始计算|查看计算结果|修改参数并计算/.test(prompt))return null
  const results=messages.slice(index+1).filter(m=>m.role==='tool')
  let step
  if(/查看计算结果/.test(prompt))step=results.length?null:['mche_calculation_get',{}]
  else if(/计算验收/.test(prompt))step=results.length?null:['mche_case_get',{}]
  else if(results.length===0)step=['mche_prepare_calculation',{}]
  else if(results.length===1){
    let result;try{result=JSON.parse(results[0].content)}catch{return {delta:{role:'assistant',content:'工具结果解析失败，请查看详情。'},finishReason:'stop'}}
    step=['mche_calculate',{preparationId:result.calculation?.preparation?.id??'missing'}]
  }
  if(!step)return {delta:{role:'assistant',content:'已处理本轮计算请求。请在 MCHE 方案的计算结果中查看实际状态；失败和非有限原始输出会保留，测试输入不代表工程验收。'},finishReason:'stop'}
  return {delta:{role:'assistant',tool_calls:[{index:0,id:`calc-${results.length}`,type:'function',function:{name:step[0],arguments:JSON.stringify(step[1])}}]},finishReason:'tool_calls'}
}
