import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { McheService } from '../src/service.js'

const original = new URL('../../../data/catalogs/flat-tubes.json', import.meta.url)
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'mche-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const catalogPath = join(root, 'catalog.json')
  await writeFile(catalogPath, await readFile(original))
  const config = { root: join(root, 'cases'), catalogPath }
  return { service: new McheService(config), config, catalogPath }
}
const value = (value, unit = 'mm') => ({ value, unit, source: '用户给定的设计条件' })
const input = (extra = {}) => ({ sessionId: 'session-a', ...extra })
async function confirmInputs(service, state) {
  return service.confirmInputs(input({ revision: state.revision, reviewId: state.inputReviewId, fields: Object.keys(state.draft) }))
}
async function select(service, name = 'A01S') {
  const state = await service.propose(input({ name, reason: '用户指定型号' }))
  return service.confirmTube(input({ revision: state.revision, proposalId: state.proposals.at(-1).id }))
}

test('exact names, range filters, no match and all 33 review models remain visible', async (t) => {
  const { service } = await fixture(t)
  assert.equal('A010S', (await service.tube(input({ name: 'A010S' }))).tube.name)
  assert.equal('A10', (await service.tube(input({ name: 'A10' }))).tube.name)
  await assert.rejects(service.tube(input({ name: 'a10' })), /不存在/)
  const all = await service.search(input({ limit: 100 }))
  assert.equal(89, all.total)
  assert.equal(33, all.items.filter((tube) => tube.review.length).length)
  const found = await service.search(input({ widthMm: { min: 15, max: 16 }, heightMm: 1.8 }))
  assert.ok(found.items.some((tube) => tube.name === 'A01S'))
  assert.ok(found.items.every((tube) => tube.geometry.widthMm >= 15 && tube.geometry.widthMm <= 16))
  assert.equal(0, (await service.search(input({ widthMm: 999 }))).total)
  await assert.rejects(service.search(input({ widthMm: { min: 17, max: 16 } })), /范围/)
  await assert.rejects(service.search(input({ widthMm: { min: -1 } })), /正数/)
})

test('draft recommendation is independent, explainable, tied and never claims performance', async (t) => {
  const { service } = await fixture(t)
  const empty = await service.recommend(input())
  assert.equal('no_conditions', empty.candidates.basis)
  await service.updateDraft(input({ changes: { tubeWidth: value(1.6, 'cm'), tubeHeight: value(1.8) } }))
  const state = await service.recommend(input({ names: ['A01S', 'A192S1'] }))
  assert.equal('draft', state.candidates.basis)
  const candidate = state.candidates.items.find((item) => item.name === 'A01S')
  assert.ok(candidate.satisfied.some((rule) => rule.field === 'tubeWidth'))
  assert.ok(candidate.unknown.some((rule) => rule.field === 'performance'))
  assert.equal(undefined, candidate.score)
  assert.equal(undefined, state.candidates.best)
  assert.ok(state.candidates.items.some((item) => item.unmet.length))
})

test('only browser confirmations capture exact immutable catalog snapshots; replay and cross-session fail', async (t) => {
  const { service } = await fixture(t)
  await assert.rejects(service.propose(input({ name: 'A01S', reason: 'x', geometry: { widthMm: 100 } })), /未知/)
  const proposed = await service.propose(input({ name: 'A01S', reason: '直接指定' }))
  const request = input({ revision: proposed.revision, proposalId: proposed.proposals.at(-1).id })
  await assert.rejects(service.confirmTube({ ...request, sessionId: 'session-b' }), /版本|建议/)
  const selected = await service.confirmTube(request)
  const snapshot = selected.snapshots[selected.selections.tube.snapshotId]
  const catalog = JSON.parse(await readFile(original, 'utf8'))
  assert.deepEqual(catalog.byName.A01S.geometry, snapshot.tube.geometry)
  assert.deepEqual(catalog.byName.A01S.evidence, snapshot.tube.evidence)
  assert.equal('mm', snapshot.fields.widthMm.unit)
  assert.ok(snapshot.catalogDigest)
  assert.equal(true, selected.status.tubeConfirmed)
  assert.equal(false, selected.status.parametersComplete)
  assert.equal(false, selected.status.dllMappingReady)
  await assert.rejects(service.confirmTube(request), /版本|处理/)
})

test('input edits invalidate only changed confirmations, reject stale proposals, and recheck selection', async (t) => {
  const { service } = await fixture(t)
  let state = await service.updateDraft(input({ changes: { tubeWidth: value(16), tubeLength: value(500) } }))
  state = await confirmInputs(service, state)
  state = await select(service)
  const snapshotId = state.selections.tube.snapshotId
  state = await service.updateDraft(input({ changes: { tubeLength: value(600) } }))
  assert.equal(true, state.status.tubeConfirmed)
  assert.equal(undefined, state.confirmed.tubeLength)
  assert.ok(state.confirmed.tubeWidth)
  const proposal = await service.propose(input({ name: 'A01S', reason: '再次核对' }))
  state = await service.updateDraft(input({ changes: { tubeWidth: value(25.4) } }))
  await assert.rejects(service.confirmTube(input({ revision: state.revision, proposalId: proposal.proposals.at(-1).id })), /失效/)
  assert.equal(false, state.status.tubeConfirmed)
  assert.equal(snapshotId, state.selections.tube.snapshotId)
  state = await service.updateDraft(input({ changes: { tubeWidth: null } }))
  assert.equal(false, state.status.tubeConfirmed, '旧确认不能自动复活')
})

test('catalog changes stale pending proposals but never replace confirmed geometry; restart restores', async (t) => {
  const { service, config, catalogPath } = await fixture(t)
  const state = await select(service)
  const snapshotId = state.selections.tube.snapshotId
  const pending = await service.propose(input({ name: 'A10', reason: '换型号' }))
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8'))
  catalog.byName.A01S.geometry.widthMm = 999
  await writeFile(catalogPath, JSON.stringify(catalog))
  await assert.rejects(service.confirmTube(input({ revision: pending.revision, proposalId: pending.proposals.at(-1).id })), /目录/)
  const restored = await new McheService(config).get(input())
  assert.equal(16, restored.snapshots[snapshotId].tube.geometry.widthMm)
  assert.equal(true, restored.catalogChanged)
  assert.equal(true, restored.status.tubeConfirmed)
  assert.equal(null, (await service.get({ sessionId: 'session-b' })).selections.tube)
})

test('confirmed tube subsection produces SI values with provenance and explicit DLL blockers', async (t) => {
  const { service, config } = await fixture(t)
  let state = await service.updateDraft(input({ changes: {
    tubeLength: value(50, 'cm'), tubeCount: value(20, '个'), tubePitch: value(0.01, 'm'),
  } }))
  const stale = input({ revision: state.revision, reviewId: state.inputReviewId, fields: ['tubeLength'] })
  state = await confirmInputs(service, state)
  await assert.rejects(service.confirmInputs(stale), /版本/)
  await select(service)
  state = await service.prepare(input())
  assert.equal(true, state.status.tubeConfirmed)
  assert.equal(true, state.status.tubeParametersComplete)
  assert.equal(false, state.status.finConfirmed)
  assert.equal(false, state.status.parametersComplete)
  assert.equal(false, state.status.dllMappingReady)
  assert.equal('tube-fin-refrigerant-logical', state.preparation.scope)
  assert.equal(0.5, state.preparation.parameters.design.tubeLength.value)
  assert.equal(20, state.preparation.parameters.design.tubeCount.value)
  assert.equal(0.01, state.preparation.parameters.design.tubePitch.value)
  assert.equal(0.016, state.preparation.parameters.geometry.width.value)
  assert.equal('B3', state.preparation.parameters.geometry.width.source.cell)
  assert.ok(state.preparation.blockers.some((item) => item.code === 'dll_port_shape_unverified'))
  assert.ok(state.preparation.blockers.some((item) => item.code === 'dll_area_semantics_unverified'))
  assert.deepEqual(state.preparation, (await new McheService(config).get(input())).preparation)
})

test('review conflicts and unknown geometry are distinct blockers; absent values never become zero', async (t) => {
  const { service } = await fixture(t)
  await select(service, 'A192S1')
  let state = await service.prepare(input())
  assert.ok(state.preparation.blockers.some((item) => item.code === 'catalog_conflict'))
  await select(service, 'A209')
  state = await service.prepare(input())
  assert.equal(null, state.preparation.parameters.geometry.neckWidth.value)
  assert.ok(state.preparation.blockers.some((item) => item.code === 'geometry_unknown'))
  assert.ok(state.preparation.blockers.some((item) => item.field === 'tubeLength'))
})

test('strict draft units, field whitelist, confirmation tokens and concurrent decisions', async (t) => {
  const { service } = await fixture(t)
  await assert.rejects(service.updateDraft(input({ changes: { tubeLength: value(1, 'ft') } })), /单位/)
  await assert.rejects(service.updateDraft(input({ changes: { tubeCount: value(1.5, '个') } })), /整数/)
  await assert.rejects(service.updateDraft(input({ changes: { wallThicknessMm: value(99) } })), /字段/)
  await assert.rejects(service.get({ sessionId: '../other' }), /会话/)
  const state = await service.propose(input({ name: 'A01S', reason: '并发确认' }))
  const request = input({ revision: state.revision, proposalId: state.proposals.at(-1).id })
  const results = await Promise.allSettled([service.confirmTube(request), service.confirmTube(request)])
  assert.equal(1, results.filter((item) => item.status === 'fulfilled').length)
})

test('an unverifiable changed constraint invalidates selection; unknown rules still block after reconfirmation', async (t) => {
  const { service } = await fixture(t)
  await select(service)
  let state = await service.updateDraft(input({ changes: { application: value('特殊场景', '') } }))
  assert.equal(false, state.status.tubeConfirmed)
  state = await select(service)
  assert.equal(true, state.status.tubeConfirmed)
  state = await service.prepare(input())
  assert.ok(state.preparation.blockers.some((item) => item.code === 'constraint_unknown' && item.field === 'application'))
})

test('draft-only inputs never enter prepared design values and corrupted persisted records fail closed', async (t) => {
  const { service, config } = await fixture(t)
  await service.updateDraft(input({ changes: { tubeLength: value(100) } }))
  let state = await service.prepare(input())
  assert.deepEqual({}, state.preparation.parameters.design)
  assert.deepEqual({}, state.preparation.parameters.geometry)
  const path = join(config.root, 'session-a', `${String(state.revision).padStart(12, '0')}.json`)
  await writeFile(path, '{broken')
  await assert.rejects(new McheService(config).get(input()), /停止写入/)
})
