import assert from 'node:assert/strict'
import { test } from 'node:test'
import { nativeFixture, post } from '../../dsh-excel-understanding/test/native-fixture.js'
import { mockMcheResponse } from './model-fixture.js'
test('真实DSH冷媒工具与三种独立确认，追问、切换浓度基准和重启恢复', { timeout: 90000 }, async t => {
  const f = await nativeFixture(t, false, { respond: mockMcheResponse })
  const asset = await fetch(f.base + '/mche-refrigerants.js'); assert.equal(200, asset.status); assert.match(await asset.text(), /refrigerantSelectionPane/)
  const reply = await post(f, '/api/chat', { prompt: '冷媒验收：选乙二醇体积浓度30%，扁管A01S、翅片B01，管长500mm、管数20、管间距10mm。' })
  assert.equal(7, reply.details.filter(d => d.mche).length)
  assert.ok(reply.details.some(d => d.mche?.view === 'selection' && d.mche.component === 'refrigerant' && d.status === 'completed'))
  const sessionId = reply.sessionId, request = (path, extra = {}, status = 200) => post(f, `/api/mche/${path}`, { sessionId, ...extra }, status)
  let state = await request('case'); assert.deepEqual({}, state.confirmed); assert.equal('draft', state.refrigerantCandidates.basis)
  state = await request('confirm-inputs', { revision: state.revision, reviewId: state.inputReviewId, fields: Object.keys(state.draft) })
  for (const component of ['refrigerant', 'tube', 'fin']) {
    const proposal = state.proposals.find(p => p.component === component)
    const req = { revision: state.revision, proposalId: proposal.id }
    state = await request(`confirm-${component}`, req); await request(`confirm-${component}`, req, 409)
  }
  await post(f, '/api/chat', { sessionId, prompt: '冷媒追问：现在选用的介质和浓度是什么？准备当前参数。' })
  state = await request('case'); assert.equal(true, state.status.parametersComplete); assert.equal(false, state.preparation.calculationReady)
  const fluid = state.preparation.parameters.refrigerant
  assert.equal('EG30Vol.', fluid.name); assert.equal(30, fluid.concentrationPercent); assert.equal('volume', fluid.concentrationBasis)
  assert.equal('E30', fluid.evidence.concentrationPercent.cell); assert.equal(null, fluid.dllFluidIdentifier)
  assert.match(JSON.stringify(f.received.at(-1).messages), /selectedRefrigerantSnapshot/)
  const saved = structuredClone(state); await f.close(); await f.boot(); assert.deepEqual(saved, await request('case'))
  const opened = await post(f, '/api/session/open', { sessionId }); assert.ok(opened.messages.some(m => m.details?.some(d => d.mche?.component === 'refrigerant')))
  await post(f, '/api/chat', { sessionId, prompt: '修改冷媒：乙二醇改为质量浓度30%，比较Vol.和Wt.两种。' })
  state = await request('case'); assert.equal(false, state.status.refrigerantConfirmed); assert.ok(state.status.tubeConfirmed && state.status.finConfirmed)
  assert.equal('EG30Wt.', state.proposals.at(-1).name)
  state = await request('confirm-inputs', { revision: state.revision, reviewId: state.inputReviewId, fields: ['refrigerantConcentrationBasis'] })
  state = await request('confirm-refrigerant', { revision: state.revision, proposalId: state.proposals.at(-1).id })
  assert.equal('EG30Wt.', state.selections.refrigerant.name); assert.equal('A01S', state.selections.tube.name); assert.equal('B01', state.selections.fin.name)
})
test('冷媒表格草稿与直接WATER选择，不自动确认、不补浓度，跨会话拒绝', { timeout: 60000 }, async t => {
  const f = await nativeFixture(t, false, { respond: mockMcheResponse })
  const reply = await post(f, '/api/chat', { prompt: '冷媒表格：按表中介质条件比较。', tables: [{ title: '冷媒条件', source: '用户粘贴', columns: ['类别', '浓度', '基准'], rows: [['乙二醇', '30%', '体积']] }] })
  let state = await post(f, '/api/mche/case', { sessionId: reply.sessionId })
  assert.equal(30, state.draft.refrigerantConcentration.value); assert.equal(null, state.selections.refrigerant)
  assert.match(JSON.stringify(f.received[0].messages), /用户粘贴/)
  const direct = await post(f, '/api/chat', { prompt: '直接冷媒：查询并建议选择WATER。' })
  const other = await post(f, '/api/mche/case', { sessionId: direct.sessionId }); assert.deepEqual({}, other.draft)
  await post(f, '/api/mche/confirm-refrigerant', { sessionId: direct.sessionId, revision: other.revision, proposalId: state.proposals.at(-1).id }, 409)
  state = await post(f, '/api/mche/confirm-refrigerant', { sessionId: direct.sessionId, revision: other.revision, proposalId: other.proposals.at(-1).id })
  assert.equal(null, state.snapshots[state.selections.refrigerant.snapshotId].refrigerant.concentrationPercent)
})
