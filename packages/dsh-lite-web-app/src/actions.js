import { randomUUID } from 'node:crypto'
import { appendActionState, ACTION_TOOL, projectActions } from './action-history.js'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

export class ActionError extends Error {
  constructor(message) { super(message); this.code = 'ACTION_INVALID' }
}
const REASON_LIMIT = 300
const DESCRIPTION = `在一段需求讨论告一段落、已有可整理的信息时，主动建议适合的对话操作。
信息尚不清楚时先追问，不要每轮都推送。用户明确请求已注册的操作时，先通过此工具展示确认入口。
每轮最多建议一项，说明基于哪些已讨论内容以及为什么现在适合执行。
本工具只提出建议，不执行操作。调用后简短告知用户可点击建议链接，在右侧详情确认或暂不执行，然后结束本轮等待确认。
不要自行生成操作结果，不要把口头同意当成卡片确认。用户拒绝后，无新信息或新请求不要重复建议。`

function definition(registry, propose) {
  return {
    name: ACTION_TOOL,
    description: `${DESCRIPTION}\n可用操作：\n${[...registry.values()].map((p) => `${p.id}：${p.description}`).join('\n')}`,
    parameters: { type: 'object', additionalProperties: false, required: ['action', 'reason'], properties: {
      action: { type: 'string', enum: [...registry.keys()] },
      reason: { type: 'string', description: '简短说明本阶段已明确的信息与建议理由，最多300字。' },
    } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }],
      presentationMeta: (_args, value) => JSON.parse(value) },
    execute: propose,
  }
}

export function createConversationActions({ tools }) {
  return new ConversationActions(tools)
}

class ConversationActions {
  constructor(tools) {
    this.tools = tools; this.plugins = new Map(); this.turns = new Map(); this.deciding = new Set()
    this.installed = false
  }
  register(plugin) {
    if (this.installed) throw new Error('请在安装对话工具前完成注册')
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(plugin.id) || this.plugins.has(plugin.id)) throw new Error('无效或重复的操作标识')
    if (!['title', 'description', 'effect', 'confirmLabel'].every((key) => typeof plugin[key] === 'string' && plugin[key].trim())) throw new Error('缺少操作说明')
    if (typeof plugin.execute !== 'function' || typeof plugin.prepare !== 'function') throw new Error('缺少操作校验或执行器')
    this.plugins.set(plugin.id, Object.freeze({ ...plugin }))
  }
  async propose(args, exec) {
    exec.signal?.throwIfAborted()
    const turn = this.turns.get(exec.agent?.id)
    if (!turn?.allow) throw new ActionError('当前对话不允许提出操作建议')
    if (turn.issued) throw new ActionError('每轮最多建议一项操作，请等待用户确认')
    const plugin = this.plugins.get(args?.action)
    if (!plugin) throw new ActionError('该操作未注册')
    if (Object.keys(args).some((key) => !['action', 'reason'].includes(key)) || typeof args.reason !== 'string' ||
      !args.reason.trim() || args.reason.length > REASON_LIMIT) throw new ActionError('请提供简短、有效的建议理由')
    turn.issued = true
    return JSON.stringify({ conversationAction: { id: randomUUID(), action: plugin.id, title: plugin.title,
      effect: plugin.effect, confirmLabel: plugin.confirmLabel, reason: args.reason.trim() },
    status: 'pending_confirmation', instruction: '卡片已生成。结束本轮，等待用户点击确认；此时尚未执行操作。' })
  }
  async decide(input) {
    const { agent, id, decision, flush } = input
    if (!['confirm', 'dismiss'].includes(decision)) throw new ActionError('无效的操作决定')
    const action = projectActions(agent.session.snapshotEvents()).find((item) => item.id === id)
    const plugin = this.plugins.get(action?.action)
    if (!plugin || action?.status !== 'pending' || this.deciding.has(agent.id)) throw new ActionError('建议已处理或失效，请继续对话获取新的建议')
    this.deciding.add(agent.id)
    try {
      if (decision === 'confirm') await plugin.prepare({ ...input, action })
      appendActionState(agent, { id, status: decision === 'dismiss' ? 'dismissed' : 'executing' })
      const userMessage = decision === 'dismiss' ? `我暂不执行“${action.title}”，先继续讨论。` : undefined
      if (userMessage) agent.session.append('user/message', createUserMessage({
        source: { kind: 'user' }, content: [{ type: 'text', text: userMessage }],
      }), { surfaceOp: 'append' })
      await flush()
      if (decision === 'dismiss') return { ok: true, userMessage }
      return await execute({ ...input, action, plugin })
    } finally { this.deciding.delete(agent.id) }
  }
  install() { this.installed = true; this.tools?.register(definition(this.plugins, this.propose.bind(this))) }
  begin(id, allow = true) { this.turns.set(id, { allow, issued: false }) }
  end(id) { this.turns.delete(id) }
}

async function execute(input) {
  const { agent, action, plugin, flush } = input
  try {
    const result = await plugin.execute(input)
    appendActionState(agent, { id: action.id, status: 'completed' })
    await flush()
    return result
  } catch (error) {
    appendActionState(agent, { id: action.id, status: 'failed' })
    await flush().catch(() => {})
    throw error
  }
}
