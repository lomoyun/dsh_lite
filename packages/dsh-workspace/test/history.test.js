import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Workspace } from '../src/index.js'

test('导入仅限当前目录主会话，跳过损坏日志，补回首次成功回复的索引', async () => {
  const cwd = process.cwd()
  const header = (id, extra = {}) => ({ id, cwd, createdAt: 1000, ...extra })
  const stored = [header('legacy'), header('pending'), header('child', { parentSession: 'legacy' }),
    header('subagent', { origin: 'subagent' }), header('foreign', { cwd: cwd + '/elsewhere' }), header('broken')]
  const events = [
    { type: 'user/message', time: 1001, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '旧会话' }] } },
    { type: 'request/header', time: 1002, data: { header: { config: { provider: 'p', model: 'm' }, system: 'old system' } } },
    { type: 'turn/end', time: 1003, data: { reason: { kind: 'completed' } } },
  ]
  const data = { sessions: [{ id: 'pending', visible: false, snapshot: { instructions: 'old project' } }] }
  const reads = []
  const workspace = { cwd, warnings: [], ctx: { sessionPersistence: { list: async () => stored } },
    store: { ready: Promise.resolve(), data, update: async (fn) => fn(data) },
    events: async (id) => { reads.push(id); if (id === 'broken') throw new Error('corrupt'); return events },
  }
  await Workspace.prototype.collectLegacy.call(workspace)
  assert.deepEqual(reads, ['legacy', 'pending', 'broken'])
  assert.equal(data.sessions.length, 2)
  const legacy = data.sessions.find((s) => s.id === 'legacy')
  assert.equal(legacy.projectId, null)
  assert.equal(legacy.updatedAt, new Date(1003).toISOString())
  assert.equal(legacy.snapshot.system, 'old system')
  assert.equal(data.sessions[0].visible, true)
  assert.equal(data.sessions[0].snapshot.instructions, 'old project')
  assert.equal(workspace.warnings.length, 1)
  await Workspace.prototype.collectLegacy.call(workspace)
  assert.equal(data.sessions.length, 2, '重复读取不能重复导入')
})

test('缺少原提示词快照或插件时拒绝恢复，不使用新的默认配置', async () => {
  const workspace = { requireRecord: async () => ({ projectId: null }),
    store: { view: async () => ({ projects: [] }) }, ctx: { get: () => undefined } }
  await assert.rejects(Workspace.prototype.resumable.call(workspace), /只能查看/)
  workspace.requireRecord = async () => ({ projectId: null, snapshot: { system: 'old' } })
  await assert.rejects(Workspace.prototype.resumable.call(workspace), /启用提示词插件/)
})

test('首条消息前仅允许仍存活的草稿会话，重启或归档后不能绕过快照门禁', async () => {
  let live = true, archived = false
  const workspace = { requireRecord: async () => ({ projectId: null, status: 'draft', archived }),
    store: { view: async () => ({ projects: [] }) }, ctx: { get: (name) => name === 'agents' ? { get: () => live ? {} : undefined } : {} } }
  assert.equal('draft', (await Workspace.prototype.resumable.call(workspace, 'draft-session')).status)
  live = false
  await assert.rejects(Workspace.prototype.resumable.call(workspace, 'draft-session'), /只能查看/)
  live = true; archived = true
  await assert.rejects(Workspace.prototype.resumable.call(workspace, 'draft-session'), /已归档/)
})
