import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { createWebHandler } from '../src/http.js'
import { streamRequest, streamingText } from '../public/chat-stream.js'
import { codeParts } from '../public/detail-drawer.js'

test('正文过滤跨分片表格和代码，完整代码进入详情且不解释 HTML', () => {
  const raw = '已解析。\n```mche-table\n{"rows": [["16"]]}\n```\n请核对。\n| 参数 | 值 |\n| --- | --- |\n| 宽度 | 16 |'
  for (let size = 1; size <= raw.length; size++) {
    assert.doesNotMatch(streamingText(raw.slice(0, size)), /mche-table|rows|```|\|/)
  }
  assert.match(streamingText(raw), /已解析。[\s\S]*请核对。/)
  const parts = codeParts('说明\n```json\n<script>data</script>\n```\n后文')
  assert.equal('code', parts[1].type)
  assert.equal('<script>data</script>\n', parts[1].text)
  assert.equal('\n后文', parts[2].text)
})

async function fixture(run) {
  const server = createServer(createWebHandler({ run, decide: run, status: async () => ({ configured: true }) }))
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  return { base: `http://127.0.0.1:${server.address().port}`, close() { server.close(); server.closeAllConnections() } }
}

test('真实 HTTP 在完成前传文字，同时保留 JSON 兼容和忙碌门禁', async () => {
  let finish, seen
  const finished = new Promise((resolve) => { finish = resolve }), first = new Promise((resolve) => { seen = resolve })
  const f = await fixture(async ({ onEvent }) => {
    onEvent?.({ type: 'text', text: '第一段中文。' }); await finished
    return { finalResponse: '第一段中文。第二段。', details: [] }
  })
  try {
    const pending = streamRequest(f.base + '/api/chat', { prompt: 'test' }, (event) => seen(event))
    const event = await first
    assert.equal('第一段中文。', event.text)
    const busy = await fetch(f.base + '/api/session/open', { method: 'POST' })
    assert.equal(409, busy.status)
    finish()
    assert.equal('第一段中文。第二段。', (await pending).finalResponse)
    const json = await fetch(f.base + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: 'test' }) })
    assert.equal('第一段中文。第二段。', (await json.json()).finalResponse)
  } finally { finish(); f.close() }
})

test('流式错误保留已收到内容，操作执行也支持流式响应', async () => {
  const received = []
  const f = await fixture(async ({ onEvent }) => {
    onEvent({ type: 'text', text: '部分结果' }); throw Object.assign(new Error('建议已处理'), { code: 'ACTION_INVALID' })
  })
  try {
    await assert.rejects(streamRequest(f.base + '/api/actions/decide', {}, (event) => received.push(event)), /建议已处理/)
    assert.equal('部分结果', received[0].text)
  } finally { f.close() }
})

test('流中断没有 done 时不报告完成，UTF8 和帧可以在任意位置拆开', async () => {
  const original = globalThis.fetch, received = []
  const bytes = new TextEncoder().encode('data: {"type":"text","text":"中文"}\n\n')
  globalThis.fetch = async () => new Response(new ReadableStream({ start(controller) {
    for (const value of bytes) controller.enqueue(Uint8Array.of(value))
    controller.close()
  } }), { headers: { 'Content-Type': 'text/event-stream' } })
  try {
    await assert.rejects(streamRequest('/test', {}, (event) => received.push(event)), /连接中断/)
    assert.equal('中文', received[0].text)
  } finally { globalThis.fetch = original }
})
