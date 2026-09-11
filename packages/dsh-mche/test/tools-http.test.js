import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { McheService } from '../src/service.js'
import { installTools } from '../src/tools.js'
import { createMcheHandler } from '../src/http.js'

async function serviceOf(t) {
  const root = await mkdtemp(join(tmpdir(), 'mche-http-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return new McheService({ root, catalogPath: fileURLToPath(new URL('../../../data/catalogs/flat-tubes.json', import.meta.url)) })
}
test('model cannot confirm, inject geometry or switch session; errors include exact missing conditions', async (t) => {
  const service = await serviceOf(t), tools = new Map()
  installTools({ tools: { register: (tool) => tools.set(tool.name, tool) } }, service)
  assert.equal(26, tools.size)
  assert.equal(false, [...tools.keys()].some((name) => name.includes('confirm')))
  const exec = { agent: { id: 'a' } }, call = async (name, args = {}) => JSON.parse(await tools.get(name).execute(args, exec))
  const get = await call('mche_case_get')
  assert.ok(get.missing.some((item) => item.field === 'tubeLength'))
  await assert.rejects(call('mche_case_get', { sessionId: 'b' }), /其他会话/)
  const forged = await call('tube_propose_selection', { name: 'A01S', reason: 'x', geometry: { widthMm: 99 } })
  assert.equal(false, forged.ok)
  assert.match(forged.message, /未知字段/)
  const absent = await call('tube_get', { name: 'bad' })
  assert.match(absent.message, /不存在/)
  const prepared = await call('mche_prepare_calculation')
  assert.equal(false, prepared.status.dllMappingReady)
  assert.ok(prepared.preparation.blockers.some((item) => item.field === 'tubeLength'))
  let offset = 0; const names = new Set()
  do {
    const raw = await tools.get('tube_search').execute({ limit: 100, offset }, exec)
    assert.ok(Buffer.byteLength(raw) <= 32000)
    const page = JSON.parse(raw)
    page.items.forEach((item) => { assert.equal(false, names.has(item.name)); names.add(item.name) })
    offset = page.nextOffset
  } while (offset !== null)
  assert.equal(89, names.size)
})
test('打开拓扑编辑器只返回当前会话导航，空流程不阻塞且工程状态不变', async t => {
  const service = await serviceOf(t), tools = new Map()
  installTools({ tools: { register: tool => tools.set(tool.name, tool) } }, service)
  const sessionId = 'open-editor', before = await service.get({ sessionId })
  const tool = tools.get('mche_calculation_open_editor')
  const raw = await tool.execute({}, { agent: { id: sessionId } }), result = JSON.parse(raw)
  assert.equal(result.mche.openEditor, true)
  assert.equal(result.mche.view, 'conditions')
  assert.equal(result.mche.sessionId, sessionId)
  assert.deepEqual(result.calculation.topology.rows[0].passes[0], { id: 'r1p1', tubeCount: null, direction: null })
  assert.deepEqual(tool.output.presentationMeta({}, raw), { mche: result.mche })
  const after = await service.get({ sessionId })
  assert.deepEqual(after.calculation, before.calculation)
  assert.equal(after.revision, before.revision)
  const ordinary = JSON.parse(await tools.get('mche_case_get').execute({}, { agent: { id: sessionId } }))
  assert.equal(ordinary.mche.openEditor, undefined)
  const invalid = await tool.execute({ changes: {} }, { agent: { id: sessionId } })
  assert.equal(JSON.parse(invalid).ok, false)
  assert.deepEqual(tool.output.presentationMeta({}, invalid), {})
  await assert.rejects(tool.execute({ sessionId: 'other' }, { agent: { id: sessionId } }), /其他会话/)
})
test('HTTP enforces same origin, archive/read-only boundary, schema, session and concurrent versions', async (t) => {
  const service = await serviceOf(t)
  const workspace = {
    requireRecord: (id) => { if (!['a', 'archived'].includes(id)) throw new Error('not owned') },
    resumable: (id) => { if (id !== 'a') throw new Error('read only') },
  }
  const server = createServer(createMcheHandler(service, { get: () => workspace }))
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => { server.close(); server.closeAllConnections() })
  const base = `http://127.0.0.1:${server.address().port}`
  const post = (path, body, origin = base) => fetch(base + '/api/mche/' + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body),
  })
  assert.equal(403, (await post('case', { sessionId: 'a' }, 'https://example.com')).status)
  assert.equal(400, (await post('case', { sessionId: 'other' })).status)
  assert.equal(200, (await post('case', { sessionId: 'archived' })).status)
  assert.equal(200, (await post('fin', { sessionId: 'archived', name: 'B01' })).status)
  assert.equal(400, (await post('fin-propose', { sessionId: 'archived', name: 'B01', reason: 'x' })).status)
  assert.equal(400, (await post('fin', { sessionId: 'other', name: 'B01' })).status)
  assert.equal(200, (await post('refrigerant', { sessionId: 'archived', name: 'WATER' })).status)
  assert.equal(400, (await post('refrigerant-propose', { sessionId: 'archived', name: 'WATER', reason: 'x' })).status)
  assert.equal(400, (await post('refrigerant', { sessionId: 'other', name: 'WATER' })).status)
  assert.equal(400, (await post('draft', { sessionId: 'archived', changes: {} })).status)
  assert.equal(400, (await post('draft', { sessionId: 'a', geometry: {} })).status)
  assert.equal(404, (await post('confirm', { sessionId: 'a' })).status)
  const state = await (await post('propose', { sessionId: 'a', name: 'A01S', reason: 'direct' })).json()
  const request = { sessionId: 'a', revision: state.revision, proposalId: state.proposals.at(-1).id }
  const replies = await Promise.all([post('confirm-tube', request), post('confirm-tube', request)])
  assert.deepEqual([200, 409], replies.map((item) => item.status).sort())
  const finState = await (await post('fin-propose', { sessionId: 'a', name: 'B01', reason: 'direct' })).json()
  const selected = await (await post('confirm-fin', { sessionId: 'a', revision: finState.revision, proposalId: finState.proposals.at(-1).id })).json()
  assert.equal(true, selected.status.tubeConfirmed)
  assert.equal(true, selected.status.finConfirmed)
})
