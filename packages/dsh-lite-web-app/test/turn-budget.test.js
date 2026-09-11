import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createTurnBudget } from '../src/turn-budget.js'

function fixture(t, config = {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let listener, removed = false
  const idle = Promise.withResolvers(), agent = { id: 'session', whenIdle: () => idle.promise }
  const ctx = { on: (_name, callback) => { listener = callback; return () => { removed = true } } }
  const budget = createTurnBudget({ ctx, agent, config })
  t.after(budget.dispose)
  return { budget, idle, emit: (type, id = 'session') => listener({ id }, { type }), removed: () => removed }
}
test('有真实工具进展时可超过旧的三分钟；完成后移除计时和监听', async (t) => {
  const f = fixture(t), waiting = f.budget.wait()
  t.mock.timers.tick(170000); f.emit('tool/result')
  t.mock.timers.tick(170000); f.emit('assistant/chunk')
  t.mock.timers.tick(10000); f.idle.resolve()
  await waiting; f.budget.dispose()
  assert.equal(true, f.removed())
})
test('心跳和其他会话事件不刷新无进展时限', async (t) => {
  const f = fixture(t), rejected = assert.rejects(f.budget.wait(), { code: 'TURN_IDLE_TIMEOUT' })
  t.mock.timers.tick(170000); f.emit('heartbeat'); f.emit('assistant/chunk', 'other')
  t.mock.timers.tick(10000); await rejected
  assert.equal(true, f.removed())
})
test('持续有进展也不能超过十分钟整轮上限', async (t) => {
  const f = fixture(t), rejected = assert.rejects(f.budget.wait(), { code: 'TURN_TIMEOUT' })
  for (let step = 0; step < 5; step++) { t.mock.timers.tick(100000); f.emit('tool/call') }
  t.mock.timers.tick(100000); await rejected
})
