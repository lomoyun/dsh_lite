const fields = ['inputTokens', 'outputTokens', 'totalTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens']

// 只累计最终 assistant/message，避免和流式 usage chunk 重复计数。
export function summarizeUsage(events) {
  const messages = events.filter((event) => event.type === 'assistant/message')
  const reported = messages.map((event) => event.data.usage).filter(Boolean)
  const result = { calls: messages.length, reportedCalls: reported.length,
    complete: messages.length > 0 && reported.length === messages.length &&
      reported.every((usage) => ['inputTokens', 'outputTokens', 'totalTokens']
        .every((field) => Number.isFinite(usage[field]) && usage[field] >= 0)) }
  for (const field of fields) {
    const values = reported.map((usage) => usage[field]).filter((value) => Number.isFinite(value) && value >= 0)
    result[field] = values.length ? values.reduce((sum, value) => sum + value, 0) : null
  }
  return result
}
