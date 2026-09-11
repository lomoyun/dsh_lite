const PREFIX = '[DSH trace] '
const sensitiveKey = /^(?:authorization|proxy[-_]?authorization|cookie|set[-_]?cookie|api[-_]?key|access[-_]?token|refresh[-_]?token|token|password|secret|credentials?)$/i
const secretEnvKey = /(?:^|_)(?:API_?KEY|KEY|TOKEN|SECRET|PASSWORD|CREDENTIALS?)$/i
const noop = () => {}
const inactive = { error: noop, finish: noop }
const decode = value => { try { return JSON.parse(value) } catch { return value } }

export function traceEnabled(value) {
  return /^(1|true|on)$/i.test(String(value ?? '').trim())
}

// Project selected event fields rather than dumping request headers or provider config.
export function traceRedactor(env = {}) {
  const secrets = Object.entries(env).filter(([key, value]) => secretEnvKey.test(key) && typeof value === 'string' && value.length >= 8)
    .map(([, value]) => value).sort((a, b) => b.length - a.length)
  function text(value) {
    for (const secret of secrets) value = value.replaceAll(secret, '[REDACTED]')
    return value.replace(/data:[^\s;,]+;base64,[A-Za-z0-9+/=]+/gi, '[BINARY OMITTED]')
      .replace(/\b(Bearer|Basic)\s+[^\s"'<>]+/gi, '$1 [REDACTED]')
      .replace(/(\bhttps?:\/\/)[^/\s:@]+:[^/\s@]+@/gi, '$1[REDACTED]@')
      .replace(/\b(api[-_]?key|access[-_]?token|refresh[-_]?token|token|password|secret|authorization)\b(["']?\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,;&]+)/gi, '$1$2[REDACTED]')
  }
  return function redact(value) {
    const ancestors = new WeakSet()
    function walk(item) {
      if (typeof item === 'string') {
        const parsed = decode(item)
        return parsed && typeof parsed === 'object' ? JSON.stringify(walk(parsed)) : text(item)
      }
      if (typeof item === 'bigint') return String(item)
      if (!item || typeof item !== 'object') return item
      if (ArrayBuffer.isView(item) || item instanceof ArrayBuffer) return '[BINARY OMITTED]'
      if (ancestors.has(item)) return '[CIRCULAR]'
      ancestors.add(item)
      const result = Array.isArray(item) ? item.map(walk) : Object.fromEntries(Object.entries(item)
        .map(([key, child]) => [key, sensitiveKey.test(key) ? '[REDACTED]' : walk(child)]))
      ancestors.delete(item)
      return result
    }
    return walk(value)
  }
}

function contentOf(content) {
  if (typeof content === 'string') return decode(content)
  return (content ?? []).map(block => {
    if (block.type === 'text' || block.type === 'reasoning') return { type: block.type, text: decode(block.text) }
    if (block.type === 'tool-call') return { type: block.type, toolCallId: block.toolCallId, name: block.name, arguments: decode(block.arguments) }
    return { type: block.type, attachmentId: block.attachment?.attachmentId ?? block.attachmentId, mediaType: block.attachment?.mediaType ?? block.mediaType }
  })
}
function failedContent(content) {
  if (typeof content === 'string') return decode(content)?.ok === false
  return (content ?? []).some(block => block.type === 'text' && decode(block.text)?.ok === false)
}

export function createTerminalTrace({ env = process.env, write = line => console.log(line), now = Date.now } = {}) {
  if (!traceEnabled(env.DSH_LITE_TRACE)) return { begin: () => inactive }
  const redact = traceRedactor(env)
  function emit(record) {
    try { write(PREFIX + JSON.stringify(redact({ timestamp: new Date(now()).toISOString(), ...record }))) }
    catch { /* Logging must never reject an Agent event or interrupt a chat. */ }
  }
  emit({ event: 'trace/enabled', setting: 'DSH_LITE_TRACE', enabled: true })
  return { begin(ctx, agent, { intent = 'chat' } = {}) {
    const started = now(), tools = new Map(), steps = new Map()
    let closed = false, failed = false, toolCalls = 0
    const log = (event, detail = {}, position = {}) => {
      if (!closed) emit({ sessionId: agent.id, event, elapsedMs: now() - started, ...position, ...detail })
    }
    log('request/start', { intent, provider: agent.options?.provider, model: agent.options?.model })
    const unsubscribe = ctx.on?.('session/event', (session, event) => {
      if (session.id !== agent.id || closed) return
      try {
        const data = event.data, position = { turn: data.turn, step: data.step }
        const stepKey = `${data.turn}:${data.step}`
        if (event.type === 'user/message') log('input', { source: data.source, content: contentOf(data.content) })
        if (event.type === 'turn/start') log(event.type, {}, position)
        if (event.type === 'step/start') { steps.set(stepKey, now()); log(event.type, {}, position) }
        if (event.type === 'assistant/message') log('assistant/response', {
          content: contentOf(data.message.content), usage: data.usage, interrupted: Boolean(data.interrupted),
        }, position)
        if (event.type === 'tool/call') {
          tools.set(data.callId, { name: data.name, started: now() }); toolCalls++
          log(event.type, { callId: data.callId, name: data.name, arguments: decode(data.arguments) }, position)
        }
        if (event.type === 'tool/result') {
          for (const result of data.message.content.filter(block => block.type === 'tool-result')) {
            const call = tools.get(result.toolCallId)
            log(event.type, { callId: result.toolCallId, name: call?.name,
              durationMs: call ? now() - call.started : undefined,
              status: result.isError || data.error || failedContent(result.content) ? 'failed' : 'completed',
              content: contentOf(result.content), error: data.error,
            }, position)
            tools.delete(result.toolCallId)
          }
        }
        if (event.type === 'step/end') {
          log(event.type, { durationMs: steps.has(stepKey) ? now() - steps.get(stepKey) : undefined }, position)
          steps.delete(stepKey)
        }
        if (event.type === 'turn/end') log(event.type, { reason: data.reason }, position)
      } catch { /* Ignore malformed diagnostic events; the original flow owns validation. */ }
    }) ?? noop
    return { error(error) {
      failed = true
      log('request/error', { error: { name: error.name, code: error.code, message: error.message } })
    }, finish() {
      if (closed) return
      log('request/end', { status: failed ? 'failed' : 'completed', toolCalls })
      closed = true
      try { unsubscribe() } catch {}
      tools.clear(); steps.clear()
    } }
  } }
}
