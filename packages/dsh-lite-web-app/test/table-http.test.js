import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { createWebHandler } from '../src/http.js'
import { fixtureWorkbook } from './table-fixtures.js'
import { AttachmentQueue } from '../public/attachment-queue.js'

async function fixture() {
  const calls = []
  const server = createServer(createWebHandler({ status: async () => ({ configured: true }),
    run: async (input) => { calls.push(input); return { finalResponse: 'ok' } } }))
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const base = `http://127.0.0.1:${server.address().port}`
  const upload = (name, body, headers = {}) => fetch(base + '/api/tables/import', {
    method: 'POST', headers: { 'Content-Type': 'application/octet-stream',
      'X-File-Name': encodeURIComponent(name), Origin: base, ...headers }, body })
  const chat = (input) => fetch(base + '/api/chat', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
  return { base, upload, chat, calls, close() { server.close(); server.closeAllConnections() } }
}

test('通过真实上传接口读取 Excel 和 CSV，不调用模型；失败后仍可导入', async () => {
  const f = await fixture()
  try {
    const xlsx = await f.upload('输入.xlsx', fixtureWorkbook())
    assert.equal(200, xlsx.status)
    const tables = (await xlsx.json()).tables
    assert.equal(2, tables.length)
    assert.equal('0016', tables[1].rows[0][0])
    assert.equal('<script>不执行</script>', tables[1].rows[0][2])
    assert.equal(400, (await f.upload('fake.xlsx', 'a,b\n1,2')).status)
    assert.equal(403, (await f.upload('输入.csv', 'a,b', { Origin: 'https://example.com' })).status)
    assert.equal(400, (await f.upload('输入.csv', '', { 'X-Text-Encoding': 'invalid' })).status)
    const csv = await f.upload('输入.csv', Buffer.from('编号,说明,值\r\n001,"中文,备注",0\r\n002,,\r\n'))
    assert.equal(200, csv.status)
    assert.deepEqual([['001', '中文,备注', '0'], ['002', '', '']], (await csv.json()).tables[0].rows)
    assert.equal(0, f.calls.length)
  } finally { f.close() }
})

test('聊天在进入 Agent 前拒绝非法结构和超限表格，合格表格保持原值', async () => {
  const f = await fixture()
  try {
    const table = { columns: ['参数', '值'], rows: [['编号', '001'], ['温度', '0'], ['缺值', '']] }
    assert.equal(400, (await f.chat({ prompt: '核对', tables: [{ ...table, rows: [[{}]] }] })).status)
    assert.equal(400, (await f.chat({ prompt: '核对', tables: Array(9).fill(table) })).status)
    assert.equal(400, (await f.chat({ prompt: '核对', intent: 'calculate', tables: [table] })).status)
    assert.equal(0, f.calls.length)
    assert.equal(200, (await f.chat({ prompt: '核对', intent: 'chat', tables: [table] })).status)
    assert.deepEqual(table.rows, f.calls[0].tables[0].rows)
    assert.equal('chat', f.calls[0].intent)
  } finally { f.close() }
})

test('附件队列按发送时机调用真实上传接口，解析完成后再提交聊天', async () => {
  const f = await fixture(), originalFetch = globalThis.fetch, requests = []
  globalThis.fetch = (url, options) => {
    const target = new URL(url, f.base)
    requests.push(target.pathname)
    return originalFetch(target, options)
  }
  try {
    const queue = new AttachmentQueue()
    queue.add([new File([fixtureWorkbook()], '工况.xlsx'), new File(['编号,值\n001,0'], '物料.csv')])
    assert.deepEqual([], requests)
    const tables = await queue.collect()
    assert.deepEqual(['/api/tables/import', '/api/tables/import'], requests)
    assert.equal(0, f.calls.length)
    assert.equal(3, tables.length)
    assert.equal(200, (await f.chat({ prompt: '根据附件继续对话', tables })).status)
    assert.deepEqual(['001', '0'], f.calls[0].tables[2].rows[0])
    queue.clear()
    assert.equal(false, queue.hasFiles())
  } finally { globalThis.fetch = originalFetch; f.close() }
})
