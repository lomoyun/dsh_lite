import test from 'node:test'
import assert from 'node:assert/strict'
import { appendMcheState } from '../src/mche-input.js'

test('新会话与外部修改后的下一轮均获得服务端最新方案版本；未启用 MCHE 时不注入', async () => {
  const messages = [], agent = { id: 'test-session', session: { append: (_type, message) => messages.push(message) } }
  let revision = 0
  const ctx = { get: name => name === 'liteMche' ? { current: async id => { assert.equal(id, agent.id); return { revision } } } : undefined }
  await appendMcheState(ctx, agent)
  revision = 7
  await appendMcheState(ctx, agent)
  assert.equal(messages.length, 2)
  for (const [index, expected] of [0, 7].entries()) {
    const text = messages[index].content.find(b => b.type === 'text').text
    const state = JSON.parse(text.split('\n')[1])
    assert.equal(state.revision, expected)
    assert.match(text, /mche_requirements_read/)
    assert.match(text, /mche_calculation_open_editor/)
    assert.match(text, /空流程、管数\/方向未填也能打开/)
  }
  await appendMcheState({ get: () => undefined }, agent)
  assert.equal(messages.length, 2)
})

test('每轮共享最新分类和推荐依据，旧逻辑缺项不注入为正式必填；页面结构修改被采用', async () => {
  const messages = [], agent = { id: 'current-case', session: { append: (_, m) => messages.push(m) } }
  const guidance = { groups: [{ id: 'structure', issues: [] }], stages: { calculationConfirmed: false } }
  const recommendationContext = { constraints: [], references: [{ field: 'application', value: 'HVAC' }] }
  let count = 30
  const ctx = { get: () => ({ current: async () => ({ revision: count, missing: [{ field: 'tubeCount' }], guidance, recommendationContext,
    calculation: { revision: count, blockers: [{ field: 'tubeCount' }], topology: { rows: [{ passes: [{ tubeCount: count, direction: 'left' }] }] } } }) }) }
  await appendMcheState(ctx, agent); count = 36; await appendMcheState(ctx, agent)
  const states = messages.map(m => JSON.parse(m.content[0].text.split('\n')[1]))
  assert.deepEqual(states[0].guidance, guidance); assert.deepEqual(states[1].recommendationContext, recommendationContext)
  assert.equal(states[1].calculation.topology.rows[0].passes[0].tubeCount, 36)
  assert.equal(states[1].missing, undefined); assert.equal(states[1].calculation.blockers, undefined)
  assert.match(messages[1].content[0].text, /ok:false/)
})
