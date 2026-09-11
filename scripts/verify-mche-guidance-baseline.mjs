// Optional before/after replay against the exact source snapshot captured before editing.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { liveRuntime } from './guidance-live-runtime.mjs'
const current = process.env.GUIDANCE_COMPARE_CURRENT === '1'
process.env.GUIDANCE_BASELINE = current ? '0' : '1'
const runtime = await liveRuntime(), out = resolve(process.env.GUIDANCE_EVIDENCE || 'docs/verification/evidence/engineering-guidance/baseline')
await mkdir(out, { recursive: true })
const report = { provider: current ? 'current real model, current source focused replay' : 'current real model, pre-change local source', home: runtime.home, turns: [] }
const post = async (path, body) => {
  const res = await fetch(runtime.base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = await res.json(); if (!res.ok) throw new Error(JSON.stringify(data)); return data
}
try {
  report.model = await (await fetch(runtime.base + '/api/status')).json()
  const { sessionId } = await post('/api/session/prepare', {}); report.sessionId = sessionId
  if (Boolean((await post('/api/mche/case', { sessionId })).guidance) !== current) throw new Error('Runtime source does not match requested replay')
  const response = await fetch(runtime.base + '/api/excel/upload', { method: 'POST', body: await readFile('答复_/3-冷凝器客户输入.xls'),
    headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': 'customer.xls', 'X-Session-Id': sessionId } })
  const { file } = await response.json()
  for (const prompt of ['读一下这个客户需求表，告诉我当前已知条件和接下来应该做什么。', '先帮我比较扁管和翅片候选，说明依据。我还没有指定新设计的管宽尺寸。', ...(current ? ['请汇总工程待办和当前计算能力。'] : [])]) {
    console.log((current ? 'RECHECK: ' : 'BASELINE: ') + prompt)
    const start = Date.now(), response = await post('/api/chat', { sessionId, prompt, ...(report.turns.length ? {} : { workbooks: [file] }) })
    report.turns.push({ prompt, elapsedMs: Date.now() - start, response }); console.log(response.finalResponse)
    await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2))
  }
  report.state = await post('/api/mche/case', { sessionId })
  if (Boolean(report.state.guidance) !== current) throw new Error('Runtime source does not match requested replay')
  report.completed = true
} catch (e) { report.failure = e.stack; process.exitCode = 1; console.error(e) }
finally { report.trace = await runtime.trace(); await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2)); await runtime.close() }
