import assert from 'node:assert/strict'
import { test } from 'node:test'
import { nativeFixture, post } from '../../dsh-excel-understanding/test/native-fixture.js'
import { mockMcheResponse } from './model-fixture.js'

test('real DSH tools, browser confirmation API, followup invalidation and restart recovery', { timeout: 90000 }, async (t) => {
  const f = await nativeFixture(t, false, { respond: mockMcheResponse })
  const reply = await post(f, '/api/chat', { prompt: '扁管验收：管宽16mm、管高1.8mm、管长500mm、管数20、管间距10mm，请给候选和型号建议。' })
  assert.equal(5, reply.details.filter((item) => item.mche).length, JSON.stringify(reply))
  const sessionId = reply.sessionId
  const request = (path, extra = {}, expected = 200) => post(f, `/api/mche/${path}`, { sessionId, ...extra }, expected)
  let state = await request('case')
  assert.equal('draft', state.candidates.basis)
  assert.equal(null, state.selections.tube)
  const reviewed = { revision: state.revision, reviewId: state.inputReviewId, fields: Object.keys(state.draft) }
  state = await request('confirm-inputs', reviewed)
  await request('confirm-inputs', reviewed, 409)
  const proposalId = state.proposals.at(-1).id
  const selected = { revision: state.revision, proposalId }
  state = await request('confirm-tube', selected)
  await request('confirm-tube', selected, 409)
  assert.equal(true, state.status.tubeConfirmed)
  const followup = await post(f, '/api/chat', { sessionId, prompt: '扁管追问：查看当前参数和缺项。' })
  assert.equal(2, followup.details.filter((item) => item.mche).length)
  state = await request('case')
  assert.equal(true, state.status.tubeParametersComplete)
  assert.equal(false, state.status.parametersComplete)
  assert.equal(false, state.status.dllMappingReady)
  assert.ok(state.preparation.blockers.some((item) => item.code === 'dll_port_shape_unverified'))
  const modelInputs = JSON.stringify(f.received.at(-1).messages)
  assert.match(modelInputs, /confirmedBy/)
  const beforeRestart = structuredClone(state)
  await f.close(); await f.boot()
  state = await request('case')
  assert.deepEqual(beforeRestart, state)
  const opened = await post(f, '/api/session/open', { sessionId })
  assert.ok(opened.messages.some((item) => item.details?.some((detail) => detail.mche?.proposalId === proposalId)))
  await post(f, '/api/chat', { sessionId, prompt: '修改扁管：管宽约束改为25.4mm，比较之前的型号。' })
  state = await request('case')
  assert.equal(false, state.status.tubeConfirmed)
  assert.equal(undefined, state.confirmed.tubeWidth)
  assert.equal(null, state.preparation)
  const other = await post(f, '/api/chat', { prompt: '直接型号：请查询A010S并建议选择，暂时不提供工况。' })
  assert.notEqual(sessionId, other.sessionId)
  const otherState = await post(f, '/api/mche/case', { sessionId: other.sessionId })
  assert.equal('A010S', otherState.proposals.at(-1).name)
  assert.deepEqual({}, otherState.draft)
  await post(f, '/api/mche/confirm-tube', { sessionId: other.sessionId, revision: otherState.revision, proposalId }, 409)
})

test('table input reaches the native agent and remains a draft until explicit field confirmation', { timeout: 45000 }, async (t) => {
  const f = await nativeFixture(t, false, { respond: mockMcheResponse })
  const table = { title: '扁管工况', source: '用户粘贴', columns: ['参数', '数值', '单位'],
    rows: [['管宽', '16', 'mm'], ['管高', '1.8', 'mm'], ['管长', '500', 'mm'], ['管数', '20', '个'], ['管间距', '10', 'mm']] }
  const reply = await post(f, '/api/chat', { prompt: '扁管表格：请按我提供的表格保存草稿并比较候选。', tables: [table] })
  const state = await post(f, '/api/mche/case', { sessionId: reply.sessionId })
  assert.deepEqual({}, state.confirmed)
  assert.equal(500, state.draft.tubeLength.value)
  assert.equal('mm', state.draft.tubeLength.unit)
  assert.match(JSON.stringify(f.received[0].messages), /用户粘贴/)
  assert.match(JSON.stringify(f.received[0].messages), /管间距/)
  assert.equal('draft', state.candidates.basis)
})
