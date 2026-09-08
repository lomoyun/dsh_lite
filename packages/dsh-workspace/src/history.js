const plain = (content) => (content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('')

export function messagesOf(events) {
  return events.flatMap((event) => {
    if (event.type === 'user/message' && event.data.source?.kind === 'user') {
      return [{ role: 'user', text: plain(event.data.content) }]
    }
    if (event.type !== 'assistant/message') return []
    const text = plain(event.data.message.content)
    return text ? [{ role: 'assistant', text, event }] : []
  })
}
export function snapshotOf(events) {
  const header = events.findLast((e) => e.type === 'request/header')?.data.header
  if (!header?.config?.provider || !header.config.model || typeof header.system !== 'string') return undefined
  const { provider, model, maxTokens } = header.config
  return { options: { provider, model, ...(maxTokens === undefined ? {} : { maxTokens }) }, system: header.system }
}
export function titleOf(events) {
  const title = events.findLast((e) => e.type === 'session/title')?.data.title
  const first = messagesOf(events).find((m) => m.role === 'user')?.text
  return String(title || first || '新对话').replace(/\s+/g, ' ').slice(0, 60)
}
export function summary(record) {
  const { snapshot, ...rest } = record
  return { ...rest, model: snapshot?.options?.model, provider: snapshot?.options?.provider,
    canResume: Boolean(snapshot?.system), snapshotAvailable: Boolean(snapshot?.system) }
}
