export async function streamRequest(url, input, onEvent) {
  const response = await fetch(url, { method: 'POST', headers: {
    'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: JSON.stringify(input) })
  if (!response.headers.get('content-type')?.includes('text/event-stream')) return jsonResponse(response)
  const reader = response.body.getReader(), decoder = new TextDecoder()
  let buffer = '', result
  try {
    while (true) {
      const { value, done } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      let boundary
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2)
        const data = frame.split('\n').filter((line) => line.startsWith('data: ')).map((line) => line.slice(6)).join('\n')
        if (!data) continue
        const event = JSON.parse(data)
        if (event.type === 'error') throw Object.assign(new Error(event.error), event)
        if (event.type === 'done') result = event.data
        else onEvent(event)
      }
      if (done) break
    }
    if (!result) throw new Error('连接中断，本轮尚未确认完成。请重新打开对话核对结果。')
    return result
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}

async function jsonResponse(response) {
  const data = await response.json()
  if (!response.ok) throw Object.assign(new Error(data.error || '请求失败'), data)
  return data
}

// 结构化内容等接收完整后进入详情，避免把半截 JSON/表格刷进正文。
export function streamingText(text) {
  let fenced = false
  return text.split('\n').filter((line) => {
    if (/^\s*```/.test(line)) { fenced = !fenced; return false }
    if (fenced || /^\s*`{1,2}$/.test(line)) return false
    return (line.match(/\|/g)?.length ?? 0) < 2 && !/^\s*\|/.test(line)
  }).join('\n')
}
