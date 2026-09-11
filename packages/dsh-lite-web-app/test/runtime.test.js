import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createChatRuntime } from '../src/runtime.js'

function fixture(mode = 'completed') {
  const handles = new Map()
  const disposed = []
  const ctx = {
    agentDefaultModel: { currentSelection: () => ({ provider: 'fixture', model: 'model' }) },
    settings: { describe: () => [] },
    agents: {
      get: (id) => handles.get(id)?.agent,
      async create({ sessionId, agentOptions }) {
        const events = []
        const agent = { id: sessionId, options: agentOptions,
          session: { snapshotEvents: () => events },
          followup() {
            events.push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'hello' }] } } })
            events.push({ type: 'turn/end', data: { reason: { kind: mode } } })
          },
          whenIdle: () => mode === 'timeout' ? new Promise(() => {}) : Promise.resolve(),
        }
        const handle = { agent, async dispose() { disposed.push(sessionId); handles.delete(sessionId) } }
        handles.set(sessionId, handle)
        return handle
      },
    },
  }
  return { handles, disposed, runtime: createChatRuntime(ctx, { cwd: process.cwd(), timeoutMs: 20, maxSessions: 1 }) }
}

test('原生 Agent 复用、容量回收、释放和关闭', async () => {
  const f = fixture()
  const first = await f.runtime.run({ prompt: 'hello' })
  const next = await f.runtime.run({ prompt: 'again', sessionId: first.sessionId })
  assert.equal(next.sessionId, first.sessionId)
  assert.equal(f.handles.size, 1)
  const second = await f.runtime.run({ prompt: 'new' })
  assert.deepEqual(f.disposed, [first.sessionId])
  await assert.rejects(f.runtime.run({ prompt: 'expired', sessionId: first.sessionId }), { code: 'SESSION_EXPIRED' })
  await f.runtime.release(second.sessionId)
  assert.equal(f.handles.size, 0)
  await f.runtime.run({ prompt: 'last' })
  await f.runtime.close()
  assert.equal(f.handles.size, 0)
  await assert.rejects(f.runtime.run({ prompt: 'closed' }), /closing/)
})

test('失败 turn 不返回部分回复，超时也释放 Agent', async () => {
  for (const mode of ['error', 'timeout']) {
    const f = fixture(mode)
    await assert.rejects(f.runtime.run({ prompt: 'test' }))
    assert.equal(f.handles.size, 0)
    assert.equal(f.disposed.length, 1)
    await f.runtime.close()
  }
})

test('工具多步骤历史与实时回复一致，整轮用量包括无文字的工具调用步骤', async () => {
  const message = (seq, turn, text, totalTokens) => ({ seq, type: 'assistant/message',
    data: { turn, message: { content: text ? [{ type: 'text', text }] : [] },
      usage: { inputTokens: totalTokens - 5, outputTokens: 5, totalTokens } } })
  const events = [message(1, 1, '', 120), message(2, 1, '请确认操作', 120), message(3, 2, '表格已整理', 80)]
  const workspace = { requireRecord: async () => ({ snapshot: {} }), events: async () => events,
    resumable: async () => { throw new Error('只读测试') } }
  const runtime = createChatRuntime({ get: (name) => name === 'liteWorkspace' ? workspace : undefined }, {})
  const opened = await runtime.open('fixture')
  assert.equal(2, opened.messages.length)
  assert.equal('请确认操作', opened.messages[0].text)
  assert.equal(240, opened.messages[0].usage.totalTokens)
  assert.equal(80, opened.messages[1].usage.totalTokens)
  assert.equal(320, opened.sessionUsage.totalTokens)
  await runtime.close()
})
