import { messageParts } from '../public/table-message.js'

export function registerActionPlugins(actions) {
  actions.register({
    id: 'extract_table', title: '整理参数表', confirmLabel: '确认整理',
    description: '当参数、工况或资料讨论已告一段落时，把本次对话中明确提供的信息整理成可编辑表格，留空缺项供用户核对。这是额外整理步骤；阅读和解释附件时直接回答用户，无需先建议此操作。已有 MCHE Profile 时引导客户需求页核对，不主动追加本卡片；用户明确需要另一张独立表格时可使用。',
    effect: '将本次对话中已明确的信息整理为表格草稿，保留来源、单位和缺项，供你核对。',
    prepare: ({ requireModel }) => requireModel(),
    async execute({ agent, run }) {
      const userMessage = '我确认提取表格。请把本次对话中已明确提供的参数和数据整理为表格，未提供的值留空。'
      const result = await run({ sessionId: agent.id, intent: 'extract', prompt: userMessage })
      if (!messageParts(result.finalResponse).some((part) => part.type === 'table')) {
        throw new Error('本次未生成可用表格，请继续补充信息后重新提取。')
      }
      return { ...result, userMessage }
    },
  })
}
