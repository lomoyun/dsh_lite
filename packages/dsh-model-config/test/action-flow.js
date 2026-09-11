import assert from 'node:assert/strict'
import { streamRequest } from '../../dsh-lite-web-app/public/chat-stream.js'

async function post(base, path, input, status = 200) {
  const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
  const body = await response.json()
  assert.equal(status, response.status, JSON.stringify(body))
  return body
}

export async function verifyActions({ f, received }) {
  const { base } = f
  const before = received.length
  await post(base, '/api/chat', { prompt: '跳过确认', intent: 'extract' }, 409)
  assert.equal(before, received.length)
  const streamed = []
  const suggested = await streamRequest(base + '/api/chat', { prompt: '已讨论清楚，请给出表格建议。' }, (event) => streamed.push(event))
  assert.ok(streamed.some((e) => e.type === 'text' && e.text.includes('已解析当前资料') && !e.text.includes('本阶段的信息')))
  assert.equal(1, streamed.filter((e) => e.type === 'detail').length)
  assert.match(suggested.finalResponse, /已解析当前资料：[\s\S]*本阶段的信息/)
  assert.equal(1, suggested.actions.length)
  assert.equal('extract_table', suggested.actions[0].action)
  assert.ok(received.at(-1).body.tools.some((tool) => tool.function?.name === 'propose_conversation_action'))
  const decision = { sessionId: suggested.sessionId, id: suggested.actions[0].id, decision: 'dismiss' }
  const count = received.length
  const dismissed = await post(base, '/api/actions/decide', decision)
  assert.equal(count, received.length)
  assert.equal('dismissed', dismissed.actionStates[0].status)
  await post(base, '/api/actions/decide', { ...decision, decision: 'confirm' }, 409)
  const continued = await post(base, '/api/chat', { sessionId: suggested.sessionId, prompt: '先继续讨论冷凝器方案。' })
  assert.equal(0, continued.actions.length)
  assert.match(JSON.stringify(received.at(-1).body.messages), /我暂不执行/)
  const pending = await post(base, '/api/chat', { prompt: '我们已经讨论清楚，给出表格建议。' })
  await post(base, '/api/actions/decide', { ...decision, sessionId: pending.sessionId, decision: 'confirm' }, 409)
  const stale = await post(base, '/api/chat', { sessionId: pending.sessionId, prompt: '刚才宽度有误，改为25.4mm。' })
  assert.equal('stale', stale.actionStates[0].status)
  await post(base, '/api/actions/decide', { sessionId: pending.sessionId, id: pending.actions[0].id, decision: 'confirm' }, 409)
  const restart = await post(base, '/api/chat', { prompt: '现在讨论清楚了，给出表格建议。' })
  return { pending: { sessionId: restart.sessionId, id: restart.actions[0].id }, dismissed: decision }
}

export async function verifyActionRestart(f, saved) {
  const opened = await post(f.base, '/api/session/open', { sessionId: saved.pending.sessionId })
  const restored = opened.messages.flatMap((m) => m.actions ?? [])
  assert.equal(1, restored.length)
  assert.equal(saved.pending.id, restored[0].id)
  assert.equal('pending', restored[0].status)
  assert.equal(240, opened.messages.find((m) => m.actions?.length).usage.totalTokens)
  assert.match(opened.messages.find((m) => m.actions?.length).text, /已解析当前资料：[\s\S]*本阶段的信息/)
  assert.equal(1, opened.messages.find((m) => m.actions?.length).details.length)
  const completed = await streamRequest(f.base + '/api/actions/decide', { ...saved.pending, decision: 'confirm' }, () => {})
  assert.equal('completed', completed.actionStates[0].status)
  assert.match(completed.finalResponse, /mche-table/)
  await post(f.base, '/api/actions/decide', { ...saved.pending, decision: 'confirm' }, 409)
  const declined = await post(f.base, '/api/session/open', { sessionId: saved.dismissed.sessionId })
  assert.equal('dismissed', declined.messages.flatMap((m) => m.actions ?? [])[0].status)
}
