import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { McheService } from '../src/service.js'
import { installTools } from '../src/tools.js'
const original = new URL('../../../data/catalogs/refrigerants.json', import.meta.url)
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'mche-refrigerant-')); t.after(() => rm(root, { recursive: true, force: true }))
  const refrigerantCatalogPath = join(root, 'refrigerants.json'); await writeFile(refrigerantCatalogPath, await readFile(original))
  const config = { root: join(root, 'cases'), refrigerantCatalogPath, catalogPath: fileURLToPath(new URL('../../../data/catalogs/flat-tubes.json', import.meta.url)) }
  return { service: new McheService(config), config }
}
const input = (extra = {}) => ({ sessionId: 'refrigerant-a', ...extra }), entry = (value, unit = '') => ({ value, unit, source: '用户提供的介质条件' })
async function select(service, name = 'EG30Vol.') {
  const state = await service.refrigerantPropose(input({ name, reason: '用户指定' }))
  return service.confirmRefrigerant(input({ revision: state.revision, proposalId: state.proposals.at(-1).id }))
}
test('冷媒精确查询、类别/序号/浓度基准筛选与分页，不补别名或空浓度', async t => {
  const { service } = await fixture(t)
  assert.equal(61, (await service.refrigerantSearch(input())).total)
  assert.deepEqual(['EG30Vol.', 'EG30Wt.'], (await service.refrigerantSearch(input({ category: 'eg', concentrationPercent: 30 }))).items.map(r => r.name))
  assert.deepEqual(['EG30Wt.'], (await service.refrigerantSearch(input({ category: 'eg', concentrationPercent: { min: 30, max: 30 }, concentrationBasis: 'mass' }))).items.map(r => r.name))
  assert.equal('CO2', (await service.refrigerantSearch(input({ sequence: 26 }))).items[0].name)
  assert.equal(null, (await service.refrigerant(input({ name: 'PROPYLEN' }))).refrigerant.concentrationPercent)
  for (const name of ['water', 'R744', 'EG30Vol']) await assert.rejects(service.refrigerant(input({ name })), /不存在/)
  for (const query of [{ concentrationPercent: 101 }, { concentrationPercent: -1 }, { concentrationBasis: 'mole' }, { sequence: 1.1 }, { bogus: 1 }]) await assert.rejects(service.refrigerantSearch(input(query)))
})
test('三种建议和确认并存，用户门禁与快照保护有效，目录变化不替换历史', async t => {
  const { service, config } = await fixture(t)
  let state = await service.propose(input({ name: 'A01S', reason: 'tube' })), tube = state.proposals.at(-1).id
  state = await service.finPropose(input({ name: 'B01', reason: 'fin' })); const fin = state.proposals.at(-1).id
  state = await service.refrigerantPropose(input({ name: 'EG30Vol.', reason: 'fluid' })); const fluid = state.proposals.at(-1).id
  await assert.rejects(service.confirmRefrigerant(input({ revision: state.revision, proposalId: tube })), /建议/)
  await assert.rejects(service.confirmFin(input({ revision: state.revision, proposalId: fluid })), /建议/)
  await assert.rejects(service.confirmRefrigerant({ sessionId: 'other', revision: state.revision, proposalId: fluid }), /版本|建议/)
  state = await service.confirmTube(input({ revision: state.revision, proposalId: tube })); state = await service.confirmFin(input({ revision: state.revision, proposalId: fin }))
  const req = input({ revision: state.revision, proposalId: fluid }), results = await Promise.allSettled([service.confirmRefrigerant(req), service.confirmRefrigerant(req)])
  assert.equal(1, results.filter(r => r.status === 'fulfilled').length)
  state = await service.get(input()); assert.ok(['tube', 'fin', 'refrigerant'].every(k => state.selections[k].confirmed))
  const catalog = JSON.parse(await readFile(original)), id = state.selections.refrigerant.snapshotId
  assert.deepEqual(catalog.byName['EG30Vol.'], state.snapshots[id].refrigerant)
  state = await service.refrigerantPropose(input({ name: 'WATER', reason: 'pending' }))
  catalog.byName['EG30Vol.'].concentrationPercent = 99; await writeFile(config.refrigerantCatalogPath, JSON.stringify(catalog))
  await assert.rejects(service.confirmRefrigerant(input({ revision: state.revision, proposalId: state.proposals.at(-1).id })), /目录/)
  const restored = await new McheService(config).get(input()); assert.equal(true, restored.refrigerantCatalogChanged)
  assert.equal(30, restored.snapshots[id].refrigerant.concentrationPercent)
})
test('条件校验与浓度基准区分；改冷媒只影响该选择，旧确认不能复活', async t => {
  const { service } = await fixture(t)
  await assert.rejects(service.updateDraft(input({ changes: { refrigerantConcentration: entry(101, '%') } })), /100/)
  await assert.rejects(service.updateDraft(input({ changes: { refrigerantConcentration: entry(30, 'wt%') } })), /单位/)
  await service.updateDraft(input({ changes: { refrigerantCategory: entry('eg'), refrigerantConcentration: entry(30, '%') } }))
  let state = await service.refrigerantRecommend(input({ names: ['EG30Vol.', 'EG30Wt.', 'WATER'] }))
  assert.ok(state.refrigerantCandidates.items[0].unknown.some(i => i.field === 'refrigerantConcentrationBasis'))
  assert.ok(state.refrigerantCandidates.items[2].unmet.length)
  await select(service); state = await service.propose(input({ name: 'A01S', reason: 'tube' })); const tube = state.proposals.at(-1).id
  state = await service.finPropose(input({ name: 'B01', reason: 'fin' })); const fin = state.proposals.at(-1).id
  state = await service.updateDraft(input({ changes: { refrigerantConcentrationBasis: entry('mass') } }))
  assert.equal(false, state.status.refrigerantConfirmed); assert.ok(state.proposals.filter(p => [tube, fin].includes(p.id)).every(p => p.status === 'pending'))
  state = await service.updateDraft(input({ changes: { refrigerantConcentrationBasis: null } })); assert.equal(false, state.status.refrigerantConfirmed)
  state = await select(service, 'EG30Wt.'); state = await service.updateDraft(input({ changes: { tubeWidth: entry(16, 'mm'), finPitch: entry(1.4, 'mm') } }))
  assert.equal(true, state.status.refrigerantConfirmed)
})
test('旧扁管/翅片会话读取不改原文件，参数只取确认快照且保留空浓度和DLL阻塞', async t => {
  const { service, config } = await fixture(t)
  let state = await service.finPropose(input({ name: 'B01', reason: 'legacy' })), old = await service.store.view(input().sessionId)
  delete old.selections.refrigerant; delete old.componentVersions.refrigerant; delete old.refrigerantCandidates
  const path = join(config.root, old.sessionId, `${String(old.revision).padStart(12, '0')}.json`), bytes = JSON.stringify(old); await writeFile(path, bytes)
  state = await new McheService(config).get(input()); assert.equal(null, state.selections.refrigerant); assert.equal(bytes, await readFile(path, 'utf8'))
  state = await service.prepare(input()); assert.equal(null, state.preparation.parameters.refrigerant)
  await select(service, 'WATER'); state = await service.prepare(input())
  assert.equal(true, state.status.refrigerantParametersComplete)
  const r = state.preparation.parameters.refrigerant
  assert.equal('WATER', r.name); assert.equal(null, r.concentrationPercent); assert.equal(null, r.dllFluidIdentifier)
  assert.equal('C29', r.evidence.name.cell); assert.equal(false, state.preparation.calculationReady)
  assert.ok(state.preparation.blockers.some(b => b.code === 'dll_refrigerant_mapping_unverified'))
})
test('模型工具保留61项分页，拒绝越权/覆盖浓度，三快照参数包不超过32KB', async t => {
  const { service } = await fixture(t), tools = new Map(); installTools({ tools: { register: t => tools.set(t.name, t) } }, service)
  const call = async (name, args = {}) => { const raw = await tools.get(name).execute(args, { agent: { id: input().sessionId } }); assert.ok(Buffer.byteLength(raw) <= 32000); return JSON.parse(raw) }
  assert.ok(![...tools.keys()].some(k => k.includes('confirm')))
  assert.equal(false, (await call('refrigerant_propose_selection', { name: 'WATER', reason: 'forged', concentrationPercent: 100 })).ok)
  await assert.rejects(call('refrigerant_get', { name: 'WATER', sessionId: 'other' }), /其他会话/)
  const draft = await call('mche_case_update_draft', { changes: { refrigerantCategory: entry('eg') } })
  assert.equal('refrigerant', draft.mche.component)
  await call('mche_case_update_draft', { changes: { refrigerantCategory: null } })
  for (const tool of ['refrigerant_search', 'refrigerant_recommend']) { let offset = 0; const names = new Set(); do {
    const data = await call(tool, { offset, limit: 100 }), page = data.refrigerantCandidates ?? data
    page.items.forEach(r => { assert.ok(!names.has(r.name)); names.add(r.name) }); offset = page.nextOffset
  } while (offset !== null); assert.equal(61, names.size) }
  let state = await service.propose(input({ name: 'A01S', reason: 'tube' })); await service.confirmTube(input({ revision: state.revision, proposalId: state.proposals.at(-1).id }))
  state = await service.finPropose(input({ name: 'B01', reason: 'fin' })); await service.confirmFin(input({ revision: state.revision, proposalId: state.proposals.at(-1).id }))
  await select(service); const prepared = await call('mche_prepare_calculation'); assert.notEqual(false, prepared.ok, prepared.message)
  assert.equal(30, (await call('mche_case_get')).selectedRefrigerantSnapshot.concentrationPercent)
})
