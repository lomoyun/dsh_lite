import test from 'node:test'
import assert from 'node:assert/strict'
import { createTerminalTrace, traceEnabled, traceRedactor } from '../src/terminal-trace.js'

function fixture(env = { DSH_LITE_TRACE: '1' }) {
  const lines = [], listeners = new Set(), agent = { id: 'session-a', options: { provider: 'test', model: 'model-a' } }
  let clock = 1000
  const trace = createTerminalTrace({ env, write: line => lines.push(line), now: () => clock })
  const ctx = { on: (name, listener) => { assert.equal(name, 'session/event'); listeners.add(listener); return () => listeners.delete(listener) } }
  return { trace, ctx, agent, lines, listeners, tick: ms => { clock += ms },
    emit: (type, data, id = agent.id) => { for (const listen of listeners) listen({ id }, { type, data }) },
    records: () => lines.map(line => JSON.parse(line.slice('[DSH trace] '.length))) }
}
const call = (callId, name, args = {}) => ({ turn: 1, step: 1, callId, name, arguments: JSON.stringify(args) })
const result = (callId, content, isError = false) => ({ turn: 1, step: 1,
  message: { content: [{ type: 'tool-result', toolCallId: callId, content, isError }] } })

test('默认与显式关闭不输出或订阅；开启只接受明确真值', () => {
  for (const value of [undefined, '', '0', 'false', 'OFF', 'typo']) {
    assert.equal(traceEnabled(value), false)
    const f = fixture({ DSH_LITE_TRACE: value }), run = f.trace.begin(f.ctx, f.agent)
    run.error(new Error('not logged')); run.finish()
    assert.equal(f.lines.length, 0); assert.equal(f.listeners.size, 0)
  }
  for (const value of ['1', 'true', ' ON ']) assert.equal(traceEnabled(value), true)
})

test('完整输入/响应/长工具结果、并行耗时、业务错误与会话隔离；完成后释放且不逐chunk重复', () => {
  const f = fixture(), first = f.trace.begin(f.ctx, f.agent)
  const other = f.trace.begin(f.ctx, { ...f.agent, id: 'session-b' })
  f.emit('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: '读取客户需求' }] })
  f.emit('turn/start', { turn: 1 }); f.emit('step/start', { turn: 1, step: 1 })
  f.emit('request/header', { authorization: 'private-header-must-not-log', config: 'private-config' })
  f.emit('tool/call', call('one', 'read', { fileId: 'file-a', revision: 0 }))
  f.tick(10); f.emit('tool/call', call('two', 'other', { range: 'B3' }))
  f.tick(30); f.emit('tool/result', result('two', JSON.stringify({ ok: false, message: '版本不匹配' })))
  const longText = '资料'.repeat(16000) + 'END'
  f.tick(20); f.emit('tool/result', result('one', [{ type: 'text', text: JSON.stringify({ records: longText }) }]))
  f.emit('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', text: 'duplicate chunk' } })
  f.emit('assistant/message', { turn: 1, step: 1, message: { content: [
    { type: 'reasoning', text: 'provider-emitted reasoning', signature: 'opaque-signature' },
    { type: 'text', text: '完整回复：请在客户需求页核对。' },
    { type: 'image', data: 'do-not-log-binary', attachmentId: 'image-1' },
  ] }, usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, reasoningTokens: 2 } })
  f.emit('step/end', { turn: 1, step: 1 }); f.emit('turn/end', { turn: 1, reason: { kind: 'completed' } })
  first.finish(); first.finish(); other.finish()
  const before = f.lines.length
  f.emit('assistant/message', { message: { content: [] } })
  assert.equal(f.lines.length, before); assert.equal(f.listeners.size, 0)
  const records = f.records(), tools = records.filter(r => r.event === 'tool/result')
  assert.deepEqual(tools.map(r => [r.name, r.status, r.durationMs]), [['other', 'failed', 30], ['read', 'completed', 60]])
  assert.equal(tools[1].content[0].text.records, longText)
  assert.deepEqual(records.find(r => r.event === 'tool/call').arguments, { fileId: 'file-a', revision: 0 })
  const responses = records.filter(r => r.event === 'assistant/response')
  assert.equal(responses.length, 1); assert.equal(responses[0].usage.totalTokens, 15)
  assert.equal(responses[0].content[0].text, 'provider-emitted reasoning')
  assert.equal(records.find(r => r.event === 'step/end').durationMs, 60)
  assert.equal(records.find(r => r.event === 'request/end' && r.sessionId === 'session-a').toolCalls, 2)
  assert.doesNotMatch(f.lines.join('\n'), /private-header|private-config|duplicate chunk|do-not-log-binary|opaque-signature/)
})

test('工具异常与请求超时有明确状态；日志出口失败不影响调用者', () => {
  const f = fixture(), run = f.trace.begin(f.ctx, f.agent)
  f.emit('tool/call', call('bad', 'excel_read_range'))
  f.emit('tool/result', result('bad', '无法读取来源', true))
  run.error(Object.assign(new Error('执行超时'), { code: 'TURN_TIMEOUT' })); run.finish()
  const rows = f.records()
  assert.equal(rows.find(r => r.event === 'tool/result').status, 'failed')
  assert.equal(rows.find(r => r.event === 'request/error').error.code, 'TURN_TIMEOUT')
  assert.equal(rows.at(-1).status, 'failed'); assert.equal(f.listeners.size, 0)
  const broken = createTerminalTrace({ env: { DSH_LITE_TRACE: 'true' }, write: () => { throw new Error('closed stdout') } })
  const active = broken.begin(f.ctx, f.agent)
  assert.doesNotThrow(() => { f.emit('assistant/message', {}); active.error(new Error('test')); active.finish() })
  assert.equal(f.listeners.size, 0)
})

test('敏感键、嵌套JSON文本、常见认证文本与环境密钥脱敏；数字及来源原文不截断', () => {
  const redact = traceRedactor({ DSH_LITE_CONNECTION_X_KEY: 'runtime-secret-value', PATH: 'unchanged' })
  const input = { arguments: { apiKey: 'structured-secret', value: 27.4 }, nested: '{"password":"json-secret","rows":[4,55]}',
    raw: 'upstream {"apiKey":"embedded-secret"}; Authorization: Bearer bearer-secret; Basic basic-secret',
    url: 'https://user:pass@host/x?token=query-secret&fileId=known-file',
    message: 'runtime-secret-value', binary: Buffer.from('image'), data: 'data:image/png;base64,aGVsbG8=', source: 'Condenser Inputs!D16 = 4 m³/h' }
  const result = redact(input), text = JSON.stringify(result)
  assert.doesNotMatch(text, /structured-secret|json-secret|embedded-secret|bearer-secret|basic-secret|query-secret|runtime-secret-value|aGVsbG8|user:pass/)
  assert.equal(result.arguments.value, 27.4); assert.deepEqual(JSON.parse(result.nested).rows, [4, 55])
  assert.equal(result.source, input.source); assert.equal(input.arguments.apiKey, 'structured-secret')
  const circular = {}; circular.self = circular
  assert.equal(redact(circular).self, '[CIRCULAR]')
})
