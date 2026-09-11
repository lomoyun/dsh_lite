export const DEFAULT_TIMEOUT_MS = 600000
export const DEFAULT_IDLE_TIMEOUT_MS = 180000
const progressTypes = new Set(['assistant/chunk', 'assistant/message', 'tool/call', 'tool/result', 'step/start', 'step/end'])

export function createTurnBudget({ ctx, agent, config }) {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS, idleTimeoutMs = config.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS
  let idleTimer, totalTimer, unsubscribe, closed = false, rejectTimeout
  const timedOut = new Promise((_, reject) => { rejectTimeout = reject })
  // followup 同步抛错时也不会留下未处理的计时器拒绝。
  timedOut.catch(() => {})
  function dispose() {
    closed = true; clearTimeout(idleTimer); clearTimeout(totalTimer); unsubscribe?.()
  }
  function fail(code) {
    if (closed) return
    dispose()
    const message = code === 'TURN_TIMEOUT' ? '本轮超过总执行时限，尚未确认完成。' : '模型或工具长时间没有新进展，本轮已停止。'
    rejectTimeout(Object.assign(new Error(message + ' 已保存的附件和结果可重新打开对话查看。'), { code, sessionId: agent.id }))
  }
  function progress() {
    if (closed) return
    clearTimeout(idleTimer)
    idleTimer = setTimeout(() => fail('TURN_IDLE_TIMEOUT'), idleTimeoutMs)
  }
  totalTimer = setTimeout(() => fail('TURN_TIMEOUT'), timeoutMs)
  progress()
  unsubscribe = ctx.on?.('session/event', (session, event) => {
    if (session.id === agent.id && progressTypes.has(event.type)) progress()
  })
  return { dispose, wait: () => Promise.race([agent.whenIdle(), timedOut]) }
}
