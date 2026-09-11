import { lastUserText } from './table-fixtures.js'
import { decodeChatInput } from '../public/table-message.js'

// 仅验收用：模拟模型真正发起 Function Calling；生产代码不以这些词判断推送时机。
export function mockActionResponse(body) {
  const text = lastUserText(body)
  if (decodeChatInput(text)?.intent === 'extract' || !/讨论清楚|给出表格建议/.test(text)) return null
  const last = body.messages.findLast((message) => ['assistant', 'tool', 'user'].includes(message.role) &&
    !String(message.content).startsWith('<system-reminder>') && !String(message.content).startsWith('Current runtime context.'))
  if (last?.role === 'tool') return { delta: { role: 'assistant', content: '本阶段的信息已梳理完毕，可以整理成表格。请点击建议链接，在右侧确认或暂不执行。' }, finishReason: 'stop' }
  return { delta: { role: 'assistant', content: '已解析当前资料：扁管宽度16mm，开窗角度27°；换热量仍待补充。', tool_calls: [{ index: 0, id: `action-${body.messages.length}`, type: 'function',
    function: { name: 'propose_conversation_action', arguments: JSON.stringify({ action: 'extract_table',
      reason: '已讨论扁管宽度、开窗角度和待补充的换热量，适合整理为表格核对。' }) } }] }, finishReason: 'tool_calls' }
}
