import { createSessionPool } from './sessions.js'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { summarizeUsage } from './usage.js'

function outputOf(events) {
  const end = events.findLast((event) => event.type === 'turn/end')
  if (!['completed', 'max-tokens'].includes(end?.data.reason.kind)) throw new Error('Turn failed')
  const message = events.findLast((event) => event.type === 'assistant/message')
  if (!message) throw new Error('No assistant response')
  return message.data.message.content.filter((block) => block.type === 'text')
    .map((block) => block.text).join('')
}

async function settled(agent, timeoutMs) {
  let timer
  try {
    await Promise.race([agent.whenIdle(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Response timeout')), timeoutMs)
    })])
  } finally { clearTimeout(timer) }
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
  if (!readOnlyReason) {
    try { if (!(await statusOf(ctx, record.snapshot.options)).configured) readOnlyReason = '原模型密钥不可用，请恢复配置或新建对话' }
    catch { readOnlyReason = '原模型配置不可用，请恢复配置或新建对话' }
  }
  const messages = []
  for (const event of events) {
    const user = event.type === 'user/message' && event.data.source?.kind === 'user'
    const assistant = event.type === 'assistant/message'
    if (!user && !assistant) continue
    const message = user ? event.data : event.data.message
    const text = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
    if (text) messages.push({ role: user ? 'user' : 'assistant', text, usage: assistant ? summarizeUsage([event]) : undefined })
  }
  return { sessionId, projectId: record.projectId, title: record.title, messages, readOnlyReason,
    model: record.snapshot?.options?.model, provider: record.snapshot?.options?.provider, sessionUsage: summarizeUsage(events) }
}
export function createChatRuntime(ctx, config) {
  const pool = createSessionPool(ctx, config)
  async function run({ prompt, sessionId, choice, projectId }) {
    const workspace = ctx.get?.('liteWorkspace')
    if (workspace && sessionId) {
      const record = await workspace.resumable(sessionId)
      if (!(await statusOf(ctx, record.snapshot.options)).configured) throw new Error('Original credential unavailable')
    }
    const handle = await pool.acquire({ sessionId, choice, projectId })
    const agent = handle.agent
    const start = agent.session.snapshotEvents().length
    try {
      agent.followup(createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'user' } }))
      await settled(agent, config.timeoutMs)
      const events = agent.session.snapshotEvents()
      const finalResponse = outputOf(events.slice(start))
      await workspace?.finish(agent.id, events, true)
      return { sessionId: agent.id, finalResponse,
        model: agent.options.model, provider: agent.options.provider,
        usage: summarizeUsage(events.slice(start)), sessionUsage: summarizeUsage(events) }
    } catch (error) {
      await workspace?.finish(agent.id, agent.session.snapshotEvents(), false).catch(() => {})
      await pool.release(agent.id)
      throw error
    }
  }
  return { run, open: (id) => openSession(ctx, id), close: pool.close, release: pool.release,
    status: async (choice, projectId) => {
      const workspace = ctx.get?.('liteWorkspace')
      return statusOf(ctx, workspace ? await workspace.choice({ choice, projectId }) : choice)
    } }
}
