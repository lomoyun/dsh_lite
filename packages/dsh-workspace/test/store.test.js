import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MetadataStore } from '../src/store.js'
import { snapshotOf, titleOf } from '../src/history.js'

test('原子元数据保存、并发冲突、失败后继续和重启读取', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'lite-workspace-test-'))
  try {
    const path = join(folder, 'metadata.json')
    const store = new MetadataStore(path)
    await store.ready
    const results = await Promise.allSettled([
      store.update((d) => d.projects.push({ id: 'one' }), 0),
      store.update((d) => d.projects.push({ id: 'two' }), 0),
    ])
    assert.equal(results[0].status, 'fulfilled')
    assert.equal(results[1].reason.code, 'WORKSPACE_CONFLICT')
    await assert.rejects(store.update(() => { throw new Error('invalid') }))
    assert.equal((await store.view()).revision, 1)
    await store.update((d) => d.projects.push({ id: 'three' }), 1)
    const reloaded = new MetadataStore(path)
    assert.deepEqual((await reloaded.view()).projects, [{ id: 'one' }, { id: 'three' }])
    await writeFile(path, 'broken-file')
    const corrupt = new MetadataStore(path)
    await assert.rejects(corrupt.view(), /保护原文件/)
    await assert.rejects(corrupt.update(() => {}))
    assert.equal(await readFile(path, 'utf8'), 'broken-file')
  } finally { await rm(folder, { recursive: true, force: true }) }
})

test('历史快照不包含凭据；缺少请求信息不猜测默认模型', () => {
  assert.equal(snapshotOf([]), undefined)
  const events = [{ type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '我的问题' }] } },
    { type: 'request/header', data: { header: { config: { provider: 'p', model: 'm', maxTokens: 512, apiKey: 'secret' }, system: 'original' } } }]
  assert.deepEqual(snapshotOf(events), { options: { provider: 'p', model: 'm', maxTokens: 512 }, system: 'original' })
  assert.equal(titleOf(events), '我的问题')
})
