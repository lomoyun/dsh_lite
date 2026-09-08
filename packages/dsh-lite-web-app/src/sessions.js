import { randomUUID } from 'node:crypto'

export function createSessionPool(ctx, config) {
  const sessions = new Map()
  let closing = false
  async function create(input) {
    const workspace = ctx.get?.('liteWorkspace')
    const sessionId = randomUUID()
    if (workspace) {
      const snapshot = await workspace.prepare({ ...input, sessionId })
      return ctx.agents.create({ sessionId, meta: { cwd: config.cwd }, agentOptions: snapshot.options })
    }
    const selected = input.choice ?? ctx.agentDefaultModel.currentSelection()
    if (input.choice) await ctx.llm.resolveModelInfo(selected.provider, selected.model)
    const limits = ctx.settings.describe({ redactSecrets: true }).some((item) => item.ns === 'model-config-ui')
      ? ctx.settings.get('model-config-ui') : { maxTokens: 8192 }
    const maxTokens = limits.modelLimits?.find((item) => item.provider === selected.provider && item.model === selected.model)?.maxTokens ?? limits.maxTokens
    return ctx.agents.create({ sessionId, meta: { cwd: config.cwd }, agentOptions: { ...selected, maxTokens } })
  }
  async function acquire(input) {
    const workspace = ctx.get?.('liteWorkspace')
    if (closing) throw new Error('Application closing')
    const { sessionId } = input
    const record = sessionId && workspace ? await workspace.resumable(sessionId) : undefined
    const live = sessions.get(sessionId)
    if (live && ctx.agents.get(live.agent.id) === live.agent) return live
    if (sessionId && !workspace) throw Object.assign(new Error('Session expired'), { code: 'SESSION_EXPIRED' })
    if (sessions.size >= config.maxSessions) await release(sessions.keys().next().value)
    const handle = record
      ? await ctx.agents.resume({ resumeSessionId: sessionId, agentOptions: record.snapshot.options })
      : await create(input)
    if (closing) { await handle.dispose(); throw new Error('Application closing') }
    sessions.set(handle.agent.id, handle)
    return handle
  }
  async function close() {
    closing = true
    await Promise.all([...sessions.values()].map((handle) => handle.dispose()))
    sessions.clear()
  }
  async function release(sessionId) {
    const handle = sessions.get(sessionId)
    if (!handle) return
    sessions.delete(sessionId)
    await handle.dispose()
  }
  return { acquire, close, release }
}
