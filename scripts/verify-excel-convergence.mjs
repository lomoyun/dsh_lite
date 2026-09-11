// Uses the current local model configuration in a separate DSH home. No model/config writes to the source home.
import { mkdir, mkdtemp, readFile, writeFile, copyFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import assert from 'node:assert/strict'

const root = fileURLToPath(new URL('../', import.meta.url))
const sourceHome = resolve(process.env.CONVERGENCE_SOURCE_HOME || join(root, '.dsh'))
const prompt = '读取一下这个文件，然后帮我整理计算需要的资料'
const scratch = join(root, '.dsh')
await mkdir(scratch, { recursive: true })
const home = await mkdtemp(join(scratch, 'convergence-live-'))
await mkdir(join(home, 'profiles/lite'), { recursive: true })
for (const name of ['settings.yaml', '.credentials.yaml', 'profiles/lite/cordis.patch.yml']) {
  try { await copyFile(join(sourceHome, name), join(home, name)) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
}
const tracePath = join(home, 'tool-metrics.jsonl'), observerPath = join(home, 'observer.mjs')
await writeFile(observerPath, `import { appendFileSync } from 'node:fs';
export const name = 'convergence-observer';
export function apply(ctx) {
  ctx.on('session/event', (session, event) => {
    if (!['tool/call', 'tool/result'].includes(event.type)) return;
    const item = { sessionId: session.id, at: Date.now(), type: event.type };
    if (event.type === 'tool/call') item.call = event.data;
    else {
      const result = event.data.message?.content?.find(b => b.type === 'tool-result');
      item.callId = result?.toolCallId; item.failed = Boolean(result?.isError);
      const content = result?.content;
      const text = typeof content === 'string' ? content : (content ?? []).filter(b => b.type === 'text').map(b => b.text).join('');
      try { const value = JSON.parse(text); item.failed ||= value.ok === false; item.profile = Boolean(value.requirements?.profileDraft); if (item.failed) item.error = value.error ?? value.message; }
      catch { if (item.failed) item.error = text; }
    }
    appendFileSync(${JSON.stringify(tracePath)}, JSON.stringify(item) + '\\n');
  });
}
`)
const patchPath = join(home, 'run.json')
await writeFile(patchPath, JSON.stringify([
  { id: 'lite-http', config: { host: '127.0.0.1', port: 0 } },
  { id: 'session-title-llm', disabled: true }, { id: 'session-telemetry-otel', disabled: true },
  { insert: [{ id: 'convergence-observer', name: pathToFileURL(observerPath).href }] },
]))
let output = '', base
const child = spawn(process.execPath, [join(root, 'scripts/start.mjs'), '--patch', patchPath], {
  cwd: home, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, DSH_HOME: home },
})
child.stdout.on('data', chunk => { output += chunk }); child.stderr.on('data', chunk => { output += chunk })
const report = { prompt, baseline: { seconds: 436, toolCalls: 20, sourceSession: 'dca79a47-8f37-40e2-abd3-50dbe05c5569' }, runs: [] }
async function post(path, body) {
  const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const result = await response.json()
  assert.equal(response.status, 200, `${path}: ${JSON.stringify(result)}`)
  return result
}
try {
  for (let i = 0; i < 200; i++) {
    if (child.exitCode !== null) throw new Error('Isolated server exited before startup')
    base = [...output.matchAll(/DSH Lite: (http:\/\/127\.0\.0\.1:\d+)/g)].at(-1)?.[1]
    if (base) {
      try { const status = await fetch(base + '/api/status'); if (status.ok) break } catch {}
    }
    await delay(100)
  }
  if (!base) throw new Error('Isolated server startup timed out')
  report.model = await (await fetch(base + '/api/status')).json()
  assert.equal(report.model.configured, true)
  const bytes = await readFile(join(root, '答复_/3-冷凝器客户输入.xls'))
  report.sourceSha256 = createHash('sha256').update(bytes).digest('hex')
  console.log(JSON.stringify({ home, base, model: report.model }))
  for (let run = 1; run <= 3; run++) {
    const { sessionId } = await post('/api/session/prepare', {})
    const upload = await fetch(base + '/api/excel/upload', { method: 'POST', body: bytes,
      headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent('3-冷凝器客户输入.xls'), 'X-Session-Id': sessionId } })
    assert.equal(upload.status, 200)
    const { file } = await upload.json(), started = Date.now()
    console.log(`RUN ${run} started ${sessionId}`)
    const response = await fetch(base + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ sessionId, prompt, workbooks: [file] }) })
    assert.equal(response.status, 200)
    const decoder = new TextDecoder(), events = []
    let pending = ''
    for await (const chunk of response.body) {
      pending += decoder.decode(chunk, { stream: true })
      let end
      while ((end = pending.indexOf('\n\n')) >= 0) {
        const block = pending.slice(0, end); pending = pending.slice(end + 2)
        if (!block.startsWith('data: ')) continue
        const event = JSON.parse(block.slice(6)); events.push(event)
        if (event.type === 'detail') console.log(`RUN ${run} ${(Date.now()-started)/1000}s ${event.detail.title} ${event.detail.status}`)
      }
    }
    const elapsedMs = Date.now() - started, done = events.findLast(e => e.type === 'done'), error = events.findLast(e => e.type === 'error')
    const state = await post('/api/mche/requirements', { sessionId })
    const trace = (await readFile(tracePath, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(e => e.sessionId === sessionId)
    const calls = trace.filter(e => e.type === 'tool/call').map(e => ({ ...e.call, elapsedMs: e.at - started }))
    const results = trace.filter(e => e.type === 'tool/result')
    const seen = new Set(), duplicates = []
    for (const call of calls) {
      const signature = JSON.stringify({ name: call.name, args: call.args ?? call.arguments ?? call.input })
      if (seen.has(signature)) duplicates.push(call)
      seen.add(signature)
    }
    const recognition = calls.filter(c => c.name.startsWith('excel_') || c.name.startsWith('mche_requirements_') || c.name === 'mche_calculation_profile_get'
      || c.name === 'mche_case_get' && c.elapsedMs <= (results.find(r => r.profile)?.at ?? Infinity) - started)
    const req = state.requirements, entries = req.assessment.entries
    const metrics = { run, sessionId, elapsedMs, firstProfileMs: results.find(r => r.profile)?.at - started || null,
      toolCalls: calls.length, recognitionCalls: recognition.length, subsequentCalls: calls.length - recognition.length,
      failedCalls: results.filter(r => r.failed), duplicateCalls: duplicates, calls, error,
      recordCount: req.document?.records.length, profileSections: req.profileDraft.sections.length,
      values: { SH: entries.refSuperheat?.normalized, RH: entries.airHumidity?.normalized, SC: entries.refSubcooling?.normalized,
        airflowRaw: req.document?.records.find(r => r.key === 'airVolumeFlow')?.raw },
      actionCards: done?.data?.actions, finalResponse: done?.data?.finalResponse }
    report.runs.push(metrics)
    await writeFile(join(home, `run-${run}.json`), JSON.stringify({ metrics, response: done, error }, null, 2))
    await writeFile(join(scratch, 'convergence-live-result.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify({ run, elapsedMs, firstProfileMs: metrics.firstProfileMs, toolCalls: calls.length,
      recognitionCalls: recognition.length, failedCalls: metrics.failedCalls.length, duplicateCalls: duplicates.length, values: metrics.values }))
    await post('/api/session/close', { sessionId })
  }
  assert.equal(report.runs.length, 3)
  assert.ok(report.runs.every(run => !run.error && run.finalResponse && run.recordCount === 26 && run.profileSections === 4
    && run.values.SH === 27.4 && run.values.RH === 55 && run.values.SC === 0 && run.values.airflowRaw === '4 m³/h'),
  '三次运行的完成状态或 Profile 数值未通过；保留报告供诊断。')
} finally {
  if (child.exitCode === null && child.signalCode === null) { const ended = once(child, 'exit'); child.kill(); await ended }
  // Keep isolated sessions/evidence for replay, but remove the copied credential contents.
  try { await writeFile(join(home, '.credentials.yaml'), '{}\n') } catch {}
  await writeFile(join(home, 'server.log'), output)
  console.log(`Evidence: ${join(scratch, 'convergence-live-result.json')}`)
}
