import assert from 'node:assert/strict'
import { test } from 'node:test'
import { historyOf, responseOf, streamTurn, toolDetail } from '../src/response-view.js'

const assistant = (seq, step, text) => ({ seq, type: 'assistant/message', data: { turn: 1, step,
  message: { content: [{ type: 'text', text }, { type: 'reasoning', text: 'private-reasoning' }] },
  usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } } })
const call = { type: 'tool/call', data: { turn: 1, callId: 'call-1', name: 'read_table', arguments: 'private-arguments' } }
const result = { type: 'tool/result', data: { turn: 1, message: { content: [{ type: 'tool-result',
  toolCallId: 'call-1', content: [{ type: 'text', text: '宽度：16 mm' }] }] } } }
const events = [assistant(1, 1, '已解析附件，缺少质量流量。'), call, result, assistant(4, 2, '请核对。'),
  { type: 'turn/end', data: { reason: { kind: 'completed' } } }]

test('业务 ok:false 在输出、历史和实时详情均计失败且不触发导航', () => {
  for (const content of [JSON.stringify({ ok: false, error: 'version_conflict' }),
    [{ type: 'text', text: JSON.stringify({ ok: false, error: 'version_conflict' }) }]]) {
    const navigation = { sessionId: 'current', view: 'conditions', openEditor: true }
    const fixture = [{ ...call, data: { ...call.data, name: 'mche_calculation_open_editor' } },
      { ...result, data: { ...result.data, meta: { mche: navigation }, message: { content: [
        { type: 'tool-result', toolCallId: 'call-1', content }] } } }, events.at(-1)]
    const detail = responseOf(fixture).details[0]
    assert.equal(detail.status, 'failed')
    assert.equal(detail.mche, undefined)
    assert.deepEqual(historyOf(fixture)[0].details[0], detail)
    const outputs = [], session = { id: 'current' }
    let listener
    streamTurn({ on: (_, fn) => { listener = fn } }, session, (event) => outputs.push(event))
    fixture.forEach((event) => listener(session, event))
    assert.deepEqual(outputs.find((event) => event.type === 'detail').detail, detail)
    fixture[1].data.message.content[0].content = JSON.stringify({ ok: true })
    assert.equal(responseOf(fixture).details[0].status, 'completed')
    assert.deepEqual(responseOf(fixture).details[0].mche, navigation)
  }
})

test('显式编辑器导航保留为可追溯详情，失败不附带导航', () => {
  const calls = new Map([['call-1', 'mche_calculation_open_editor']])
  const navigation = { sessionId: 'current', view: 'conditions', openEditor: true }
  const event = { ...result, data: { ...result.data, meta: { mche: navigation } } }
  const detail = toolDetail(event, calls)
  assert.equal(detail.title, '打开流向与拓扑编辑器')
  assert.deepEqual(detail.mche, navigation)
  const failed = structuredClone(event)
  failed.data.message.content[0].isError = true
  assert.equal(toolDetail(failed, calls).mche, undefined)
})

test('同轮工具前后正文完整保留，详情可追溯且历史用量只计一次', () => {
  const output = responseOf(events), history = historyOf(events)
  assert.equal('已解析附件，缺少质量流量。\n\n请核对。', output.finalResponse)
  assert.equal(1, output.details.length)
  assert.equal('宽度：16 mm', output.details[0].text)
  assert.deepEqual(output.segments, [{ id: '1:1', text: '已解析附件，缺少质量流量。' }, { id: '1:2', text: '请核对。' }])
  assert.equal('1:1', output.details[0].afterText)
  assert.equal('completed', output.finishReason)
  assert.equal(1, history.length)
  assert.equal(output.finalResponse, history[0].text)
  assert.deepEqual(output.details, history[0].details)
  assert.deepEqual(output.segments, history[0].segments)
  assert.equal(30, history[0].usage.totalTokens)
  assert.equal(false, history[0].incomplete)
  assert.equal(true, historyOf(events.slice(0, -1))[0].incomplete)
  assert.doesNotMatch(JSON.stringify(output), /private-/)
})

test('文字分片在完成前可见，最终消息替换分片，不泄露推理或其他会话', () => {
  const outputs = [], session = { id: 'current' }
  let listener, removed = false
  const ctx = { on: (name, fn) => { assert.equal('session/event', name); listener = fn; return () => { removed = true } } }
  const stop = streamTurn(ctx, session, (event) => outputs.push(event))
  const delta = (type, text) => ({ type: 'assistant/chunk', data: { turn: 1, step: 1, chunk: { type, text } } })
  listener({ id: 'other' }, delta('text-delta', 'other-session'))
  listener(session, delta('reasoning-delta', 'private-reasoning'))
  listener(session, delta('text-delta', '已解析'))
  assert.equal('已解析', outputs.at(-1).text)
  for (const event of events) listener(session, event)
  assert.equal(responseOf(events).finalResponse, outputs.at(-1).text)
  assert.equal(1, outputs.filter((e) => e.type === 'detail').length)
  assert.equal('1:1', outputs.find((e) => e.type === 'detail').detail.afterText)
  assert.deepEqual({ type: 'tool', id: 'call-1', status: 'running' }, outputs.find((e) => e.type === 'tool'))
  assert.deepEqual(responseOf(events).segments, outputs.at(-1).segments)
  assert.doesNotMatch(JSON.stringify(outputs), /private-|other-session/)
  stop(); assert.equal(true, removed)
})

test('无前置正文、并行调用和失败重试按调用时段落定位，截断保留真实原因', () => {
  const toolCall = (id) => ({ ...call, data: { ...call.data, callId: id } })
  const toolResult = (id, failed = false) => ({ type: 'tool/result', data: { message: { content: [
    { type: 'tool-result', toolCallId: id, isError: failed, content: 'evidence' }] } } })
  const fixture = [toolCall('first'), toolResult('first'), assistant(1, 1, '读取正文。'),
    toolCall('parallel-a'), toolCall('parallel-b'), assistant(2, 2, ''), toolResult('parallel-b', true),
    assistant(3, 3, '修正后重试。'), toolCall('retry'), toolResult('parallel-a'), toolResult('retry'),
    assistant(4, 4, '输出被截断'), { type: 'turn/end', data: { reason: { kind: 'max-tokens' } } }]
  const output = responseOf(fixture)
  assert.deepEqual(output.details.map(({ id, afterText, status }) => [id, afterText, status]), [
    ['first', undefined, 'completed'], ['parallel-b', '1:1', 'failed'],
    ['parallel-a', '1:1', 'completed'], ['retry', '1:3', 'completed']])
  assert.equal(output.segments.length, 3)
  assert.equal('max-tokens', historyOf(fixture)[0].finishReason)
  assert.doesNotMatch(JSON.stringify(output), /private-/)
})
