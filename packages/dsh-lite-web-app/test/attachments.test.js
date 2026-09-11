import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AttachmentQueue } from '../public/attachment-queue.js'
import { TABLE_LIMITS } from '../public/table-data.js'

const file = (name, size = 100) => ({ name, size, lastModified: 1 })
const table = (name) => ({ title: name, columns: ['参数', '值'], rows: [['宽度', '16']] })

test('选文件仅加入队列，发送才上传，移除或重复添加不会发送请求', async () => {
  const calls = []
  const queue = new AttachmentQueue({ upload: async (input) => { calls.push(input.name); return { tables: [table(input.name)] } } })
  queue.add([file('工况.xlsx'), file('物料.csv')])
  queue.add([file('工况.xlsx')])
  assert.equal(2, queue.list().length)
  assert.equal(0, calls.length)
  queue.remove(queue.list()[1].id)
  const tables = await queue.collect()
  assert.deepEqual(['工况.xlsx'], calls)
  assert.equal('16', tables[0].rows[0][1])
  assert.equal(1, queue.list().length)
  assert.equal('ready', queue.list()[0].status)
  queue.clear()
  assert.equal(false, queue.hasFiles())
})

test('多附件部分失败时保留队列，重试复用已解析文件', async () => {
  const calls = []
  let failed = true
  const queue = new AttachmentQueue({ upload: async (input) => {
    calls.push(input.name)
    if (input.name === 'second.csv' && failed) throw new Error('读取失败')
    return { tables: [table(input.name)] }
  } })
  queue.add([file('first.xlsx'), file('second.csv')])
  await assert.rejects(queue.collect(), /second.csv.*读取失败/)
  assert.deepEqual(['ready', 'error'], queue.list().map((item) => item.status))
  failed = false
  assert.equal(2, (await queue.collect()).length)
  assert.deepEqual(['first.xlsx', 'second.csv', 'second.csv'], calls)
})

test('发送期间锁定队列，类型、尺寸与合并后的表格上限均校验', async () => {
  const pending = Promise.withResolvers()
  const queue = new AttachmentQueue({ upload: () => pending.promise })
  assert.throws(() => queue.add([file('scan.pdf')]), /暂不支持/)
  assert.throws(() => queue.add([file('empty.csv', 0)]), /空/)
  assert.throws(() => queue.add([file('large.csv', TABLE_LIMITS.fileBytes + 1)]), /5 MB/)
  assert.throws(() => queue.add(Array.from({ length: 9 }, (_, i) => file(`${i}.csv`))), /8/)
  assert.equal(0, queue.list().length)
  queue.add([file('data.CSV')])
  const collecting = queue.collect(Array.from({ length: 8 }, () => table('已有')))
  assert.throws(() => queue.add([file('next.csv')]), /上传/)
  await assert.rejects(queue.collect(), /上传/)
  pending.resolve({ tables: [table('新表')] })
  await assert.rejects(collecting, /8/)
  assert.equal(1, queue.list().length)
})

test('工作簿模式保留同名附件，发送时绑定会话，重试复用文件 ID，解析失败保留原件状态', async () => {
  const calls = [], queue = new AttachmentQueue({ deduplicate: false, upload: async (input, context) => {
    calls.push({ input, context })
    return { file: { fileId: `file-${calls.length}`, sessionId: context.sessionId, status: calls.length === 2 ? 'failed' : 'ready', error: calls.length === 2 ? '损坏' : undefined } }
  } })
  queue.add([file('同名.xlsx'), file('同名.xlsx')])
  assert.equal(2, queue.list().length); assert.equal(0, calls.length)
  const result = await queue.collectWorkbooks({ sessionId: 'session' })
  assert.notEqual(result[0].fileId, result[1].fileId)
  assert.deepEqual(['ready', 'saved'], queue.list().map((entry) => entry.status))
  assert.equal('session', calls[0].context.sessionId)
  assert.deepEqual(result, await queue.collectWorkbooks({ sessionId: 'session' }))
  assert.equal(2, calls.length)
})
