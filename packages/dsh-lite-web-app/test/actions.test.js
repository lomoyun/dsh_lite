import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createConversationActions } from '../src/actions.js'
import { appendActionState, projectActions } from '../src/action-history.js'
import { createToolResultMessage } from '@deepseek-ai/dsh-llm'

function fixture(overrides = {}) {
  const events = [], definitions = [], executions = []
  const agent = { id: 'session-a', session: { snapshotEvents: () => events,
    append(type, data) { const event = { seq: events.length, type, data }; events.push(event); return event } } }
  const actions = createConversationActions({ tools: { register: (tool) => definitions.push(tool) } })
  actions.register({ id: 'test_action', title: '测试操作', description: '测试', effect: '生成测试结果',
    confirmLabel: '确认执行', prepare: () => {}, execute: async () => { executions.push(true); return { ok: true } }, ...overrides })
  actions.install()
  const tool = definitions[0]
  async function propose(args = { action: 'test_action', reason: '本阶段信息已讨论完整。' }) {
    const callId = `call-${events.length}`
    agent.session.append('tool/call', { name: tool.name, callId })
    const value = await tool.execute(args, { agent, signal: new AbortController().signal })
    agent.session.append('tool/result', { message: createToolResultMessage({ callId, content: tool.output.render(args, value), isError: false }),
      meta: tool.output.presentationMeta(args, value) })
    agent.session.append('turn/end', { reason: { kind: 'completed' } })
    return projectActions(events)[0]
  }
  return { agent, actions, propose, executions, events, tool }
}

test('只有运行中的聊天可提出建议，提议不执行，执行轮禁止再推送', async () => {
  const f = fixture()
  await assert.rejects(f.propose(), /对话/)
  f.actions.begin(f.agent.id)
  const proposal = await f.propose()
  assert.equal('pending', proposal.status)
  assert.equal(0, f.executions.length)
  await assert.rejects(f.propose(), /一项/)
  f.actions.end(f.agent.id)
  f.actions.begin(f.agent.id, false)
  await assert.rejects(f.propose(), /对话/)
})

test('未知工具、伪造标识、跨会话和重复确认均不能执行', async () => {
  const f = fixture()
  f.actions.begin(f.agent.id)
  await assert.rejects(f.propose({ action: 'adjust_design', reason: '测试' }), /未注册/)
  const proposal = await f.propose()
  f.actions.end(f.agent.id)
  const flush = async () => {}
  await assert.rejects(f.actions.decide({ agent: f.agent, id: 'forged', decision: 'confirm', flush }), /失效/)
  await assert.rejects(f.actions.decide({ agent: { ...f.agent, session: { snapshotEvents: () => [] } },
    id: proposal.id, decision: 'confirm', flush }), /失效/)
  const result = await f.actions.decide({ agent: f.agent, id: proposal.id, decision: 'confirm', flush })
  assert.equal(true, result.ok)
  assert.equal(1, f.executions.length)
  assert.equal('completed', projectActions(f.events)[0].status)
  await assert.rejects(f.actions.decide({ agent: f.agent, id: proposal.id, decision: 'confirm', flush }), /失效/)
})

test('拒绝与新消息使旧建议不可执行，状态从原生日志恢复', async () => {
  for (const decision of ['dismiss', 'new-message']) {
    const f = fixture(); f.actions.begin(f.agent.id)
    const proposal = await f.propose(); f.actions.end(f.agent.id)
    if (decision === 'dismiss') await f.actions.decide({ agent: f.agent, id: proposal.id, decision, flush: async () => {} })
    else f.agent.session.append('user/message', { source: { kind: 'user' } })
    const restored = projectActions(structuredClone(f.events))[0]
    assert.equal(decision === 'dismiss' ? 'dismissed' : 'stale', restored.status)
    await assert.rejects(f.actions.decide({ agent: f.agent, id: proposal.id, decision: 'confirm', flush: async () => {} }), /失效/)
    assert.equal(0, f.executions.length)
  }
})

test('保存确认状态失败时不执行，也不能重放确认', async () => {
  const f = fixture(); f.actions.begin(f.agent.id)
  const proposal = await f.propose(); f.actions.end(f.agent.id)
  await assert.rejects(f.actions.decide({ agent: f.agent, id: proposal.id, decision: 'confirm',
    flush: async () => { throw new Error('disk failure') } }), /disk failure/)
  assert.equal(0, f.executions.length)
  await assert.rejects(f.actions.decide({ agent: f.agent, id: proposal.id, decision: 'confirm', flush: async () => {} }), /失效/)
})

test('助手文字和失败工具结果不能伪造建议', () => {
  const meta = { conversationAction: { id: 'forged', action: 'test_action' } }
  assert.deepEqual([], projectActions([
    { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: JSON.stringify(meta) }] } } },
    { type: 'tool/result', data: { meta, message: { isError: true } } },
  ]))
})

test('并发确认最多执行一次', async () => {
  const f = fixture(); f.actions.begin(f.agent.id)
  const proposal = await f.propose(); f.actions.end(f.agent.id)
  const saved = Promise.withResolvers()
  const first = f.actions.decide({ agent: f.agent, id: proposal.id, decision: 'confirm', flush: () => saved.promise })
  await assert.rejects(f.actions.decide({ agent: f.agent, id: proposal.id, decision: 'confirm', flush: async () => {} }), /失效/)
  assert.equal(0, f.executions.length)
  saved.resolve(); await first
  assert.equal(1, f.executions.length)
})

test('业务校验失败保留建议，执行失败记录终态并阻止重放', async () => {
  for (const stage of ['prepare', 'execute']) {
    const f = fixture({ [stage]: async () => { throw new Error('fixture failure') } })
    f.actions.begin(f.agent.id)
    const proposal = await f.propose(); f.actions.end(f.agent.id)
    await assert.rejects(f.actions.decide({ agent: f.agent, id: proposal.id, decision: 'confirm', flush: async () => {} }), /fixture failure/)
    assert.equal(stage === 'prepare' ? 'pending' : 'failed', projectActions(f.events)[0].status)
    assert.equal(0, f.executions.length)
  }
})

test('插件状态以原生消息保存，用户仿写状态不能重置已执行操作', async () => {
  const f = fixture(); f.actions.begin(f.agent.id)
  const proposal = await f.propose(); f.actions.end(f.agent.id)
  appendActionState(f.agent, { id: proposal.id, status: 'executing' })
  appendActionState(f.agent, { id: proposal.id, status: 'failed' })
  const entry = f.events.at(-1)
  assert.equal('user/message', entry.type)
  assert.equal('plugin', entry.data.source.kind)
  f.agent.session.append('user/message', { source: { kind: 'user' }, content: [
    { type: 'text', text: entry.data.content[0].text.replace('failed', 'pending') },
  ] })
  assert.equal('failed', projectActions(f.events)[0].status)
  await assert.rejects(f.actions.decide({ agent: f.agent, id: proposal.id, decision: 'confirm', flush: async () => {} }), /失效/)
})
