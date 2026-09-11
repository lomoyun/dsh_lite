import assert from 'node:assert/strict'
import { decodeChatInput, messageParts } from '../../dsh-lite-web-app/public/table-message.js'
import { fixtureWorkbook, lastUserText } from '../../dsh-lite-web-app/test/table-fixtures.js'

const tableOf = (text) => messageParts(text).filter((part) => part.type === 'table').map((part) => part.table)
async function post(base, path, input) {
  const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
  const body = await response.json()
  assert.equal(200, response.status, JSON.stringify(body))
  return body
}

export async function verifyTables({ f, received }) {
  const upload = await fetch(f.base + '/api/tables/import', { method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': 'sample.xlsx' }, body: fixtureWorkbook() })
  assert.equal(200, upload.status)
  const imported = await upload.json()
  assert.equal(2, imported.tables.length)
  assert.equal('0016', imported.tables[1].rows[0][0])
  const suggested = await post(f.base, '/api/chat', { prompt: '扁管宽度16mm，开窗角度27度，换热量未提供。本阶段已经讨论清楚。' })
  assert.equal('pending', suggested.actions[0]?.status, JSON.stringify({ suggested,
    toolResults: received.at(-1).body.messages.filter((m) => m.role === 'tool') }))
  assert.equal(0, tableOf(suggested.finalResponse).length)
  const extracted = await post(f.base, '/api/actions/decide', { sessionId: suggested.sessionId, id: suggested.actions[0].id, decision: 'confirm' })
  assert.equal('', extracted.tableWarning)
  assert.equal('16', tableOf(extracted.finalResponse)[0].rows[0][1])
  const initialSystem = received.at(-1).body.messages.find((m) => m.role === 'system')?.content
  const table = tableOf(extracted.finalResponse)[0]
  table.rows[0][1] = '25.4'
  await post(f.base, '/api/chat', { sessionId: extracted.sessionId, prompt: '使用我确认的表格继续讨论。', tables: [table] })
  assert.equal('25.4', decodeChatInput(lastUserText(received.at(-1).body)).tables[0].rows[0][1])
  assert.equal(initialSystem, received.at(-1).body.messages.find((m) => m.role === 'system')?.content)
  await post(f.base, '/api/session/close', { sessionId: extracted.sessionId })
  await verifyTableRestart(f, { sessionId: extracted.sessionId, table })
  await post(f.base, '/api/chat', { sessionId: extracted.sessionId, prompt: '继续核对表格。' })
  assert.match(JSON.stringify(received.at(-1).body.messages), /25\.4/)
  await post(f.base, '/api/chat', { prompt: '这是一个独立新会话。' })
  assert.doesNotMatch(JSON.stringify(received.at(-1).body.messages), /25\.4|对话表格输入/)
  return { sessionId: extracted.sessionId, table }
}

export async function verifyTableRestart(f, saved) {
  const opened = await post(f.base, '/api/session/open', { sessionId: saved.sessionId })
  assert.equal('', opened.readOnlyReason)
  const confirmed = opened.messages.filter((m) => m.role === 'user').map((m) => decodeChatInput(m.text)).filter(Boolean)
  assert.deepEqual(saved.table, confirmed.at(-1).tables[0])
  assert.ok(opened.messages.some((m) => m.role === 'assistant' && tableOf(m.text).length))
}
