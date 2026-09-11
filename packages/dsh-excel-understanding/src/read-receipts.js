import { READ_VERSION } from './read-coverage.js'

const cursors = new WeakMap(), queues = new WeakMap()

function receipt(event, calls, sessionId) {
  if (event.type === 'tool/call') { calls.set(event.data.callId, event.data.name); return }
  if (event.type !== 'tool/result') return
  const block = event.data.message?.content?.find((item) => item.type === 'tool-result')
  const name = calls.get(block?.toolCallId)
  calls.delete(block?.toolCallId)
  if (block?.isError || name !== 'excel_read_range') return
  try {
    const text = typeof block.content === 'string' ? block.content : block.content.filter((part) => part.type === 'text').map((part) => part.text).join('')
    const value = JSON.parse(text)
    // 原生日志中的完整结果才可确认；宿主截断并附加的 spill 提示无法通过 JSON 校验。
    if (value.readVersion === READ_VERSION && value.sessionId === sessionId && Array.isArray(value.cells)) return value
  } catch { /* 截断或旧版本结果不能作为已完整送达的证据。 */ }
}
async function confirmNewEvents(service, agent) {
  const events = agent.session?.snapshotEvents() ?? []
  let cursor = cursors.get(agent) ?? { offset: 0, calls: new Map() }
  if (cursor.offset > events.length) cursor = { offset: 0, calls: new Map() }
  cursors.set(agent, cursor)
  for (let i = cursor.offset; i < events.length; i++) {
    const value = receipt(events[i], cursor.calls, agent.id)
    if (value) {
      try { await service.acknowledge(value) }
      catch (error) { if (error.status !== 404) throw error }
    }
    cursor.offset = i + 1
  }
}
export function syncReadReceipts(service, agent) {
  const previous = queues.get(agent) ?? Promise.resolve()
  const current = previous.catch(() => {}).then(() => confirmNewEvents(service, agent))
  queues.set(agent, current)
  return current
}
