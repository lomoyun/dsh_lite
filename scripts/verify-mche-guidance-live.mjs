import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { liveRuntime } from './guidance-live-runtime.mjs'

const { chromium } = await import(pathToFileURL(process.argv[2] ?? 'C:/Users/huangyunfei/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href)
const out = resolve(process.env.GUIDANCE_EVIDENCE || 'docs/verification/evidence/engineering-guidance/live')
await mkdir(out, { recursive: true })
const runtime = await liveRuntime(), report = { at: new Date().toISOString(), provider: 'current real model', home: runtime.home, runs: [], errors: [] }
let browser, page
async function post(path, body) {
  const response = await fetch(runtime.base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = await response.json(); assert.equal(response.status, 200, `${path}: ${JSON.stringify(data)}`); assert.notEqual(data.ok, false)
  return data
}
async function chat(sessionId, prompt, workbooks) {
  console.log(JSON.stringify({ event: 'chat/start', sessionId, prompt }))
  const start = Date.now(), response = await fetch(runtime.base + '/api/chat', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: JSON.stringify({ sessionId, prompt, ...(workbooks ? { workbooks } : {}) }) })
  assert.equal(response.status, 200)
  let pending = '', events = []; const decoder = new TextDecoder()
  for await (const chunk of response.body) {
    pending += decoder.decode(chunk, { stream: true }); let end
    while ((end = pending.indexOf('\n\n')) >= 0) {
      const block = pending.slice(0, end); pending = pending.slice(end + 2)
      if (!block.startsWith('data: ')) continue
      const event = JSON.parse(block.slice(6)); events.push(event)
      if (event.type === 'detail') console.log(JSON.stringify({ event: 'tool/detail', title: event.detail.title, status: event.detail.status }))
    }
  }
  const done = events.findLast(e => e.type === 'done'), error = events.findLast(e => e.type === 'error')
  const result = { prompt, elapsedMs: Date.now() - start, response: done?.data, error, events }
  console.log(JSON.stringify({ event: 'chat/end', elapsedMs: result.elapsedMs, error, response: done?.data?.finalResponse }))
  return result
}
try {
  report.model = await (await fetch(runtime.base + '/api/status')).json(); assert.equal(report.model.configured, true)
  console.log(JSON.stringify({ base: runtime.base, home: runtime.home, model: report.model }))
  browser = await chromium.launch({ headless: true, executablePath: process.env.MCHE_BROWSER_EXECUTABLE ?? 'C:/Users/huangyunfei/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe' })
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(15000)
  page.on('pageerror', e => report.errors.push(e.message))
  const bytes = await readFile('答复_/3-冷凝器客户输入.xls'); report.sourceSha256 = createHash('sha256').update(bytes).digest('hex')
  for (let n = 1; n <= Number(process.env.GUIDANCE_RUNS || 2); n++) {
    if (n > 1) { await page.close(); page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(15000); page.on('pageerror', e => report.errors.push(e.message)) }
    const { sessionId } = await post('/api/session/prepare', {}), run = { n, sessionId, turns: [], states: [], checks: [] }
    report.runs.push(run)
    const upload = await fetch(runtime.base + '/api/excel/upload', { method: 'POST', body: bytes,
      headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': 'customer.xls', 'X-Session-Id': sessionId } })
    assert.equal(upload.status, 200); const { file } = await upload.json()
    const snapshot = async label => { const state = await post('/api/mche/case', { sessionId }); run.states.push({ label, state }); return state }
    const turn = async (prompt, files) => { const result = await chat(sessionId, prompt, files); run.turns.push(result);
      await writeFile(join(out, `run-${n}.json`), JSON.stringify(run, null, 2)); assert.ok(result.response?.finalResponse && !result.error); return result }
    await turn('读一下这个客户需求表，告诉我当前已知条件和接下来应该做什么。', [file])
    let state = await snapshot('requirements-read'); assert.equal(state.requirements.document?.records.length, 26)
    await turn('先帮我比较扁管和翅片候选，说明依据。我还没有指定新设计的管宽尺寸。')
    state = await snapshot('unconstrained-comparison'); assert.equal(state.draft.tubeWidth, undefined)
    await turn('请把扁管 A10、翅片 B04 和表中冷媒作为待确认建议，保留原表的疑点。')
    state = await snapshot('proposals')
    await page.goto(runtime.base)
    await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/session/open')), page.getByRole('button', { name: /读一下这个客户需求表/ }).first().click()])
    await page.waitForFunction(() => !document.querySelector('#send').disabled)
    await page.getByRole('button', { name: 'MCHE 方案', exact: true }).click()
    const drawer = page.locator('#detail-drawer'), active = () => drawer.locator('.detail-entry:not([hidden])')
    const fluid = state.requirements.assessment.entries.refrigerant.normalized
    for (const [component, label, button] of [['tube', '扁管', '确认选择 A10'], ['fin', '翅片', '确认选择翅片 B04'], ['refrigerant', '冷媒', `确认选择冷媒 ${fluid}`]]) {
      await active().getByRole('button', { name: label, exact: true }).click()
      await active().getByRole('button', { name: '型号确认', exact: true }).click()
      await active().getByRole('button', { name: button, exact: true }).click()
      await page.waitForFunction(() => [...document.querySelectorAll('.mche-view')].some(e => e.textContent.includes('已更新。')))
      state = await snapshot(`confirm-${component}`); assert.equal(state.selections[component]?.confirmed, true)
    }
    await page.screenshot({ path: join(out, `run-${n}-confirmed.png`) })
    await drawer.locator('.detail-close').click()
    await turn('现在空气和冷媒的流向分别确定了吗？')
    // This request is sent through the real chat UI to exercise automatic navigation.
    await page.getByRole('textbox', { name: '输入你的问题' }).fill('打开流动动画和结构编辑器，我来填写。')
    await page.getByRole('button', { name: '发送消息', exact: true }).click()
    await page.waitForFunction(() => !document.querySelector('#send').disabled, null, { timeout: 300000 })
    assert.equal(await drawer.evaluate(e => e.open), true)
    await active().locator('.mche-flow').waitFor()
    await page.screenshot({ path: join(out, `run-${n}-empty-animation.png`) })
    const beforeEditing = await snapshot('animation-open')
    await active().getByLabel('第1排流程1管数', { exact: true }).fill('30')
    await active().getByLabel('第1排流程1方向', { exact: true }).selectOption('left')
    await active().getByLabel('结构来源依据', { exact: true }).fill('独立验收：工程师页面明确单排30根、左进右出')
    for (const [label, val, unit] of [['每根管带翅片长度', '500', 'mm'], ['每根管无翅片总长度', '0', 'mm']]) {
      await active().getByLabel(label, { exact: true }).fill(val)
      await active().getByLabel(label + '单位', { exact: true }).selectOption(unit)
      await active().getByLabel(label + '依据', { exact: true }).fill('独立验收：用户明确数值，非正式工程验证')
    }
    await active().getByLabel('空气流向', { exact: true }).selectOption('right_to_left')
    await active().getByLabel('空气流向依据', { exact: true }).fill('独立验收：用户明确空气右向左')
    const saved = page.waitForResponse(r => r.url().endsWith('/api/mche/calculation-draft'))
    await active().getByRole('button', { name: '保存计算草稿', exact: true }).click(); assert.equal((await saved).status(), 200)
    state = await snapshot('page-structure-saved')
    assert.equal(state.calculation.topology.rows[0].passes[0].tubeCount, 30)
    assert.equal(state.calculation.confirmed, false)
    assert.equal(beforeEditing.calculation.revision + 1, state.calculation.revision)
    await page.screenshot({ path: join(out, `run-${n}-saved-structure.png`) })
    await drawer.locator('.detail-close').click()
    await turn('我已在页面保存了结构。请汇总当前部件、主工况和测试条件、管数、两侧流向及还需要确认的参数。')
    state = await snapshot('summary'); run.trace = (await runtime.trace()).filter(r => r.sessionId === sessionId)
    run.checks.push('26条原始需求', '无默认管宽', '三部件页面确认', '真实模型导航打开空动画', '页面结构保存与后续对话', '目录疑点及实际执行限制人工复核')
    await writeFile(join(out, `run-${n}.json`), JSON.stringify(run, null, 2))
    await post('/api/session/close', { sessionId })
  }
  assert.deepEqual(report.errors, [])
  report.completed = true
} catch (error) {
  report.failure = error.stack; process.exitCode = 1
  console.error(error)
  await page?.screenshot({ path: join(out, 'failure.png') }).catch(() => {})
} finally {
  report.trace = await runtime.trace()
  await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2))
  await browser?.close(); await runtime.close()
  console.log(`Evidence: ${out}`)
}
