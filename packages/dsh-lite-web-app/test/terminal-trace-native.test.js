import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { nativeFixture, post } from '../../dsh-excel-understanding/test/native-fixture.js'
import { mockRequirementsResponse } from '../../dsh-mche/test/requirements-model-fixture.js'

test('真实DSH进程：环境开关控制终端工具参数/完整Profile/模型response，网页结果保持一致', { timeout: 90000 }, async t => {
  for (const enabled of ['0', '1']) await t.test(`DSH_LITE_TRACE=${enabled}`, async t => {
    const secret = 'terminal-test-private-key'
    const respond = body => {
      const result = mockRequirementsResponse(body)
      if (result?.finishReason === 'stop') {
        result.delta.content += `\n测试文本 ${secret}`
        result.delta.reasoning_content = 'fixture provider returned reasoning'
      }
      return result
    }
    const f = await nativeFixture(t, false, { respond, env: { DSH_LITE_TRACE: enabled, TERMINAL_TEST_API_KEY: secret } })
    const { sessionId } = await post(f, '/api/session/prepare', {})
    const upload = await fetch(f.base + '/api/excel/upload', { method: 'POST',
      body: await readFile(new URL('../../../答复_/3-冷凝器客户输入.xls', import.meta.url)),
      headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': 'trace-test.xls', 'X-Session-Id': sessionId } })
    assert.equal(upload.status, 200)
    const { file } = await upload.json()
    const reply = await post(f, '/api/chat', { sessionId, prompt: '需求表验收：读取客户需求并给出Boundary建议。', workbooks: [file] })
    assert.equal(reply.details.length, 1); assert.match(reply.finalResponse, /SH=27.4 K/)
    await f.close() // Drain stdout before asserting terminal output.
    const rows = f.output.split(/\r?\n/).filter(line => line.startsWith('[DSH trace] ')).map(line => JSON.parse(line.slice('[DSH trace] '.length)))
    if (enabled === '0') return assert.equal(rows.length, 0)
    assert.equal(rows[0].event, 'trace/enabled')
    const call = rows.find(row => row.event === 'tool/call')
    assert.equal(call.sessionId, sessionId); assert.equal(call.name, 'mche_requirements_read')
    assert.deepEqual(call.arguments, { fileId: file.fileId, revision: 0 })
    const result = rows.find(row => row.event === 'tool/result')
    assert.equal(result.callId, call.callId); assert.equal(result.status, 'completed')
    assert.equal(result.content[0].text.requirements.recordCount, 26)
    assert.equal(result.content[0].text.requirements.profileDraft.sections.length, 4)
    assert.ok(rows.some(row => row.event === 'assistant/response' && JSON.stringify(row.content).includes('SH=27.4 K')))
    assert.ok(rows.some(row => row.event === 'assistant/response' && row.content.some(block => block.type === 'reasoning' && block.text === 'fixture provider returned reasoning')))
    assert.doesNotMatch(JSON.stringify(reply), /fixture provider returned reasoning/)
    assert.equal(rows.at(-1).event, 'request/end'); assert.equal(rows.at(-1).status, 'completed')
    assert.equal(rows.at(-1).toolCalls, 1)
    assert.doesNotMatch(f.output, new RegExp(secret)); assert.match(f.output, /REDACTED/)
    assert.match(reply.finalResponse, new RegExp(secret)) // Logging does not rewrite the actual response.
  })
})
