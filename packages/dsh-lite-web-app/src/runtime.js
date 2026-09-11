import { createSessionPool } from './sessions.js'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { summarizeUsage } from './usage.js'
import { encodeChatInput, messageParts } from '../public/table-message.js'
import { ActionError, createConversationActions } from './actions.js'
import { projectActions } from './action-history.js'
import { registerActionPlugins } from './action-plugins.js'
import { historyOf, responseOf, streamTurn } from './response-view.js'
import { workbookInput } from './excel-input.js'
import { createTurnBudget } from './turn-budget.js'
import { appendMcheState } from './mche-input.js'
import { createTerminalTrace } from './terminal-trace.js'

function outputOf(events) {
  const end = events.findLast((event) => event.type === 'turn/end')
  if (!['completed', 'max-tokens'].includes(end?.data.reason.kind)) throw new Error('Turn failed')
  if (!events.some((event) => event.type === 'assistant/message')) throw new Error('No assistant response')
  return responseOf(events)
}

async function statusOf(ctx, choice) {
  const selected = choice ?? ctx.agentDefaultModel.currentSelection()
  if (choice) await ctx.llm.resolveModelInfo(selected.provider, selected.model)
  const entry = ctx.llm.listConfigurableProviders().find((item) => item.provider === selected.provider)
  const profile = entry?.settingsPath.reduce((value, key) => value?.[key], ctx.settings.get(entry.settingsNs))
  const ref = profile?.apiKeyEnv || (selected.provider === 'deepseek-official' ? 'DEEPSEEK_API_KEY' : '')
  const configured = ref ? (await ctx.credentials.describe(credentialRef(ref))).configured : false
  return { model: selected.model, configured }
}


async function openSession(ctx, sessionId) {
  const workspace = ctx.get?.('liteWorkspace')
  if (!workspace) throw Object.assign(new Error('Session expired'), { code: 'SESSION_EXPIRED' })
  const record = await workspace.requireRecord(sessionId)
  const events = await workspace.events(sessionId)
  let readOnlyReason = ''
  try { await workspace.resumable(sessionId) } catch (error) { readOnlyReason = error.message }
  const mcheWritable = !readOnlyReason && Boolean(ctx.get?.('liteMche'))
  if (!readOnlyReason) {
    try { if (!(await statusOf(ctx, record.snapshot.options)).configured) readOnlyReason = '原模型密钥不可用，请恢复配置或新建对话' }
    catch { readOnlyReason = '原模型配置不可用，请恢复配置或新建对话' }
  }
  const messages = historyOf(events)
  return { sessionId, projectId: record.projectId, title: record.title, messages, readOnlyReason, mcheWritable,
    model: record.snapshot?.options?.model, provider: record.snapshot?.options?.provider, sessionUsage: summarizeUsage(events) }
}
export function createChatRuntime(ctx, config) {
  const pool = createSessionPool(ctx, config)
  const actions = createConversationActions({ tools: ctx.get?.('tools') })
  registerActionPlugins(actions)
  actions.install()
  const state = { ctx, config, pool, actions, trace: createTerminalTrace() }
  const run = (input) => runTurn(state, input)
  return { run: (input) => {
    if (input.intent === 'extract') throw new ActionError('请先确认对话中的操作建议')
    return run(input)
  }, decide: (input) => decideAction({ ...state, run }, input),
  open: (id) => openSession(ctx, id), close: pool.close, release: pool.release,
  prepare: async (input) => ({ sessionId: (await pool.acquire(input)).agent.id }),
  status: async (choice, projectId) => {
    const workspace = ctx.get?.('liteWorkspace')
    return statusOf(ctx, workspace ? await workspace.choice({ choice, projectId }) : choice)
  } }
}

async function runTurn({ ctx, config, pool, actions, trace }, { prompt, sessionId, choice, projectId, tables = [], workbooks = [], intent = 'chat', onEvent }) {
    const workspace = ctx.get?.('liteWorkspace')
    if (workspace && sessionId) {
      const record = await workspace.resumable(sessionId)
      if (!(await statusOf(ctx, record.snapshot.options)).configured) throw new Error('Original credential unavailable')
    }
    const handle = await pool.acquire({ sessionId, choice, projectId })
    const agent = handle.agent
    const start = agent.session.snapshotEvents().length
    const unsubscribe = streamTurn(ctx, agent, onEvent)
    const budget = createTurnBudget({ ctx, agent, config })
    const terminal = trace.begin(ctx, agent, { intent })
    actions.begin(agent.id, intent === 'chat')
    try {
      const files = await workbookInput(ctx, agent, workbooks)
      await appendMcheState(ctx, agent)
      const userText = encodeChatInput({ prompt, tables, intent, workbooks: files })
      const userMessage = createUserMessage({ content: [{ type: 'text', text: userText }], source: { kind: 'user' } })
      ctx.get?.('liteMche')?.beginTurn?.(agent.id, { prompt, message: userMessage, intent })
      agent.followup(userMessage)
      await budget.wait()
      await ctx.get?.('excelUnderstanding')?.syncReads?.(agent)
      const events = agent.session.snapshotEvents()
      const { finalResponse, segments, details, finishReason } = outputOf(events.slice(start))
      const tableWarning = intent === 'extract' && !messageParts(finalResponse).some((part) => part.type === 'table')
        ? '本轮未返回可用表格。请补充要提取的内容，或让 AI 按表格重新整理。' : ''
      await workspace?.finish(agent.id, events, true)
      const actionStates = projectActions(events)
      return { sessionId: agent.id, finalResponse, segments, details, finishReason, tableWarning, actionStates,
        actions: actionStates.filter((item) => item.eventIndex >= start),
        model: agent.options.model, provider: agent.options.provider,
        usage: summarizeUsage(events.slice(start)), sessionUsage: summarizeUsage(events) }
    } catch (error) {
      terminal.error(error)
      await ctx.get?.('excelUnderstanding')?.syncReads?.(agent).catch(() => {})
      await workspace?.finish(agent.id, agent.session.snapshotEvents(), false).catch(() => {})
      await pool.release(agent.id)
      throw error
    } finally { ctx.get?.('liteMche')?.endTurn?.(agent.id); budget.dispose(); unsubscribe(); terminal.finish(); actions.end(agent.id) }
}

async function decideAction({ ctx, pool, actions, run }, { sessionId, id, decision, onEvent }) {
  if (!sessionId || typeof id !== 'string') throw new ActionError('缺少对话或建议标识')
  const { agent } = await pool.acquire({ sessionId })
  const flush = () => ctx.sessions.flush(agent.session)
  const requireModel = async () => {
    if (!(await statusOf(ctx, agent.options)).configured) throw new ActionError('当前模型不可用，请先恢复模型配置')
  }
  try {
    const result = await actions.decide({ agent, id, decision, flush, requireModel, run: (input) => run({ ...input, onEvent }) })
    return { ...result, sessionId, actionStates: projectActions(agent.session.snapshotEvents()) }
  } catch (error) {
    if (error.code === 'ACTION_INVALID') throw error
    throw new ActionError('操作未完成，请重新打开本对话查看状态，补充信息后再试。')
  }
}
