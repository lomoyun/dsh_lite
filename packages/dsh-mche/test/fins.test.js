import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { McheService } from '../src/service.js'
import { installTools } from '../src/tools.js'

const finPath = new URL('../../../data/catalogs/fins.json', import.meta.url)
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'mche-fin-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const finCatalogPath = join(root, 'fins.json')
  await writeFile(finCatalogPath, await readFile(finPath))
  const config = { root: join(root, 'cases'), finCatalogPath, catalogPath: fileURLToPath(new URL('../../../data/catalogs/flat-tubes.json', import.meta.url)) }
  return { service: new McheService(config), config }
}
const input = (extra = {}) => ({ sessionId: 'fin-a', ...extra })
const entry = (value, unit = 'mm') => ({ value, unit, source: '用户输入的翅片条件' })
async function select(service, name = 'B01') {
  const state = await service.finPropose(input({ name, reason: '用户指定翅片' }))
  return service.confirmFin(input({ revision: state.revision, proposalId: state.proposals.at(-1).id }))
}

test('164翅片分区、Code共享、范围筛选和零值，复合描述不误作数字', async t => {
  const { service } = await fixture(t)
  assert.equal(164, (await service.finSearch(input({ limit: 100 }))).total)
  assert.deepEqual((await service.finSearch(input({ code: '310150' }))).items.map(f => f.name), ['B0f', 'B150'])
  assert.equal(0, (await service.finSearch(input({ code: '390065' }))).total)
  assert.equal('B423', (await service.finSearch(input({ code: '390065-66' }))).items[0].name)
  const result = await service.finSearch(input({ widthMm: { min: 15, max: 16 }, heightPostBrazingMm: 8.1, finPitchMm: 1.4 }))
  assert.ok(result.items.some(f => f.name === 'B01'))
  assert.ok(result.items.every(f => f.geometry.widthMm >= 15 && f.geometry.widthMm <= 16))
  assert.equal(0, (await service.finSearch(input({ section: 'tube_insert', widthMm: 21 }))).total)
  assert.equal(8, (await service.fin(input({ name: 'B139' }))).fin.geometry.slotPitchMm)
  assert.equal('B184', (await service.finSearch(input({ louverCount: 0, louverAngleDeg: { min: 0, max: 0 } }))).items[0].name)
  await assert.rejects(service.finSearch(input({ louverCount: 0.1 })), /整数/)
  await assert.rejects(service.finSearch(input({ finPitchMm: 0 })), /正数/)
  await assert.rejects(service.finSearch(input({ heightMm: 8 })), /字段/)
  await assert.rejects(service.fin(input({ name: 'B0A' })), /不存在/)
  const b = await service.fin(input({ name: 'B01' }))
  assert.equal(0, b.conflicts.length)
  assert.equal(2, b.specifications.length)
  assert.equal('≤0.45', b.fin.evidence.rMm.raw)
  assert.ok((await service.fin(input({ name: 'B421' }))).conflicts.some(r => r.code === 'r_exceeds_dimensions'))
  assert.ok((await service.fin(input({ name: 'B0k' }))).restrictions.some(r => r.code === 'section_restriction'))
})

test('草稿字段、分区和单位明确，推荐保留不满足/未知且不排名', async t => {
  const { service } = await fixture(t)
  await service.updateDraft(input({ changes: { finSection: entry('main', ''), finWidth: entry(1.6, 'cm'), finPitch: entry(1.4) } }))
  const state = await service.finRecommend(input({ names: ['B01', 'B150'] }))
  assert.equal('draft', state.finCandidates.basis)
  assert.ok(state.finCandidates.items[0].satisfied.some(r => r.field === 'finWidth'))
  assert.ok(state.finCandidates.items[1].unmet.some(r => r.field === 'finSection'))
  assert.ok(state.finCandidates.items[1].unknown.some(r => r.field === 'finWidth'))
  assert.ok(state.finCandidates.items.every(f => f.score === undefined))
  await service.updateDraft(input({ changes: { finLouverAngle: entry(0, '°'), finLouverCount: entry(0, '个') } }))
  await assert.rejects(service.updateDraft(input({ changes: { finSection: entry('guess', '') } })), /取值/)
  await assert.rejects(service.updateDraft(input({ changes: { finPitch: entry(1, 'inch') } })), /单位/)
})

test('扁管和翅片建议/确认互不覆盖；并发、重放和跨部件/会话请求被拒绝', async t => {
  const { service } = await fixture(t)
  let state = await service.propose(input({ name: 'A01S', reason: '扁管' }))
  const tubeProposalId = state.proposals.at(-1).id
  state = await service.finPropose(input({ name: 'B01', reason: '翅片' }))
  const finProposalId = state.proposals.at(-1).id
  assert.equal('pending', state.proposals.find(p => p.id === tubeProposalId).status)
  await assert.rejects(service.confirmTube(input({ revision: state.revision, proposalId: finProposalId })), /建议/)
  await assert.rejects(service.confirmFin(input({ revision: state.revision, proposalId: tubeProposalId })), /建议/)
  state = await service.confirmTube(input({ revision: state.revision, proposalId: tubeProposalId }))
  const request = input({ revision: state.revision, proposalId: finProposalId })
  await assert.rejects(service.confirmFin({ ...request, sessionId: 'fin-b' }), /版本|建议/)
  const decisions = await Promise.allSettled([service.confirmFin(request), service.confirmFin(request)])
  assert.equal(1, decisions.filter(r => r.status === 'fulfilled').length)
  state = await service.get(input())
  assert.equal('A01S', state.selections.tube.name)
  assert.equal('B01', state.selections.fin.name)
  assert.equal(true, state.status.tubeConfirmed)
  assert.equal(true, state.status.finConfirmed)
  const original = JSON.parse(await readFile(finPath, 'utf8')), snapshot = state.snapshots[state.selections.fin.snapshotId]
  assert.deepEqual(original.byName.B01, snapshot.fin)
  assert.deepEqual(original.sections.main.fields, snapshot.fields)
  await assert.rejects(service.finPropose(input({ name: 'B01', reason: '伪造', geometry: {} })), /字段/)
  await assert.rejects(service.confirmFin(request), /版本/)
})

test('只使受影响部件的建议和确认失效，删除约束不复活历史确认', async t => {
  const { service } = await fixture(t)
  let state = await service.propose(input({ name: 'A01S', reason: '扁管' }))
  const tubeId = state.proposals.at(-1).id
  state = await service.updateDraft(input({ changes: { finWidth: entry(16), finPitch: entry(1.4) } }))
  assert.equal('pending', state.proposals.find(p => p.id === tubeId).status)
  state = await service.confirmTube(input({ revision: state.revision, proposalId: tubeId }))
  await select(service)
  state = await service.updateDraft(input({ changes: { tubeWidth: entry(25.4) } }))
  assert.equal(false, state.status.tubeConfirmed)
  assert.equal(true, state.status.finConfirmed)
  state = await service.propose(input({ name: 'A10', reason: '换管' }))
  const pendingTube = state.proposals.at(-1).id
  state = await service.finPropose(input({ name: 'B01', reason: '再次建议' }))
  const pendingFin = state.proposals.at(-1).id
  state = await service.updateDraft(input({ changes: { finWidth: entry(25.4) } }))
  assert.equal('pending', state.proposals.find(p => p.id === pendingTube).status)
  assert.equal('stale', state.proposals.find(p => p.id === pendingFin).status)
  assert.equal(false, state.status.finConfirmed)
  await assert.rejects(service.confirmFin(input({ revision: state.revision, proposalId: pendingFin })), /失效/)
  state = await service.updateDraft(input({ changes: { finWidth: null } }))
  assert.equal(false, state.status.finConfirmed)
})

test('目录摘要变化拒绝旧建议，重启保留历史几何；旧扁管会话无损读取', async t => {
  const { service, config } = await fixture(t)
  let state = await select(service)
  const snapshotId = state.selections.fin.snapshotId
  state = await service.finPropose(input({ name: 'B02', reason: '待确认' }))
  const catalog = JSON.parse(await readFile(config.finCatalogPath, 'utf8'))
  catalog.byName.B01.geometry.widthMm = 999
  await writeFile(config.finCatalogPath, JSON.stringify(catalog))
  await assert.rejects(service.confirmFin(input({ revision: state.revision, proposalId: state.proposals.at(-1).id })), /目录/)
  const restored = await new McheService(config).get(input())
  assert.equal(true, restored.finCatalogChanged)
  assert.equal(16, restored.snapshots[snapshotId].fin.geometry.widthMm)
  assert.equal(null, (await service.get({ sessionId: 'other' })).selections.fin)
  const legacy = await service.propose({ sessionId: 'legacy', name: 'A01S', reason: '旧版扁管建议' })
  const old = await service.store.view('legacy')
  delete old.selections.fin; delete old.componentVersions; delete old.finCandidates
  old.proposals.forEach(p => { delete p.component; delete p.componentVersion })
  const path = join(config.root, 'legacy', `${String(old.revision).padStart(12, '0')}.json`)
  const bytes = JSON.stringify(old); await writeFile(path, bytes)
  const view = await new McheService(config).get({ sessionId: 'legacy' })
  assert.equal(null, view.selections.fin)
  assert.equal(bytes, await readFile(path, 'utf8'))
  const confirmed = await service.confirmTube({ sessionId: 'legacy', revision: view.revision, proposalId: legacy.proposals[0].id })
  assert.equal(true, confirmed.status.tubeConfirmed)
})

test('参数仅来自确认快照；范围不当作矛盾、继承单位不盲目换算，DLL与装配仍阻塞', async t => {
  const { service } = await fixture(t)
  let state = await service.prepare(input())
  assert.deepEqual({}, state.preparation.parameters.finGeometry)
  await select(service)
  state = await service.prepare(input())
  assert.equal(true, state.status.finParametersComplete)
  assert.equal(0.016, state.preparation.parameters.finGeometry.width.value)
  assert.equal('D6', state.preparation.parameters.finGeometry.width.source.cell)
  assert.equal(null, state.preparation.parameters.finGeometry.r.value)
  assert.equal('≤0.45', state.preparation.parameters.finGeometry.r.source.raw)
  assert.ok(!state.preparation.blockers.some(b => b.code === 'fin_catalog_conflict'))
  assert.ok(state.preparation.blockers.some(b => b.code === 'tube_fin_compatibility_unverified'))
  assert.equal(false, state.preparation.calculationReady)
  await select(service, 'B150L')
  state = await service.prepare(input())
  assert.equal(null, state.preparation.parameters.finGeometry.slotLength.value)
  assert.equal(10.1, state.preparation.parameters.finGeometry.slotLength.original.value)
  assert.ok(state.preparation.blockers.some(b => b.code === 'fin_units_unverified'))
  await select(service, 'B184')
  state = await service.prepare(input())
  assert.equal(0, state.preparation.parameters.finGeometry.louverCount.original.value)
})

test('模型不能确认或越权；查询推荐响应按32KB分页且完整保留型号，双快照摘要可读', async t => {
  const { service } = await fixture(t), tools = new Map(), exec = { agent: { id: 'fin-a' } }
  installTools({ tools: { register: tool => tools.set(tool.name, tool) } }, service)
  assert.equal(false, [...tools.keys()].some(n => n.includes('confirm')))
  const call = async (name, args = {}) => {
    const raw = await tools.get(name).execute(args, exec)
    assert.ok(Buffer.byteLength(raw) <= 32000, `${name}: ${Buffer.byteLength(raw)}`)
    const result = JSON.parse(raw)
    assert.notEqual(result.ok, false, raw)
    return result
  }
  for (const tool of ['fin_search', 'fin_recommend']) {
    let offset = 0; const names = new Set()
    do {
      const result = await call(tool, { offset, limit: 100 }), page = result.finCandidates ?? result
      for (const fin of page.items) { assert.ok(!names.has(fin.name)); names.add(fin.name) }
      offset = page.nextOffset
    } while (offset !== null)
    assert.equal(164, names.size)
  }
  assert.equal('fin', (await call('fin_get', { name: 'B01' })).mche.component)
  await assert.rejects(call('fin_get', { sessionId: 'other', name: 'B01' }), /其他会话/)
  let state = await service.propose(input({ name: 'A01S', reason: '扁管' }))
  await service.confirmTube(input({ revision: state.revision, proposalId: state.proposals.at(-1).id }))
  await select(service)
  const summary = await call('mche_case_get')
  assert.equal('A01S', summary.selectedSnapshot.name)
  assert.equal('B01', summary.selectedFinSnapshot.name)
  await call('mche_prepare_calculation')
  await call('fin_recommend', { names: ['B01', 'B150L'] })
})
