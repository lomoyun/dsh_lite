// Real links and native failed-run evidence in an isolated fixture, never production data.
import { pathToFileURL } from 'node:url'
import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { nativeFixture, post } from '../packages/dsh-excel-understanding/test/native-fixture.js'
import { conditions, value, repo } from '../packages/dsh-mche/test/calculation-fixture.js'
const { chromium } = await import(pathToFileURL('C:/Users/huangyunfei/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href)
const cleanup = [], checks = [], errors = [], out = 'docs/verification/evidence/mche-detail-panel'
await mkdir(out, { recursive: true })
const f = await nativeFixture({ after: fn => cleanup.push(fn) }, false, { respond: () => ({ delta: { role: 'assistant', content: '详情入口验收' }, finishReason: 'stop' }),
  env: { MCHE_PYTHON_X86: join(repo, '.dsh/mche-python-x86/python.exe'), MCHE_RUNTIME_ROOT: join(repo, 'runtime') } })
let browser, page
try {
  const { sessionId } = await post(f, '/api/chat', { prompt: '详情入口验收' })
  const request = (path, body = {}) => post(f, '/api/mche/' + path, { sessionId, ...body })
  let state = await request('case')
  for (const [propose, confirm, name] of [['propose', 'confirm-tube', 'A44S'], ['fin-propose', 'confirm-fin', 'B01'], ['refrigerant-propose', 'confirm-refrigerant', 'WATER']]) {
    state = await request(propose, { name, reason: '浏览器隔离夹具，非工程资料' })
    state = await request(confirm, { revision: state.revision, proposalId: state.proposals.at(-1).id })
  }
  const g = state.snapshots[state.selections.tube.snapshotId].tube.geometry
  state = await request('calculation-draft', { changes: { ...conditions(), portWidth: value(g.flowAreaMm2 / g.portHeightMm / g.portCount, 'mm') } })
  state = await request('calculation-confirm', { revision: state.calculation.revision, reviewId: state.calculation.reviewId })
  state = await request('prepare'); assert.equal(state.calculation.preparation.calculationReady, true)
  const runs = []
  for (const requestId of ['panel-run-one', 'panel-run-two']) {
    let run = await request('calculate', { preparationId: state.calculation.preparation.id, requestId })
    for (let i = 0; i < 100 && ['queued', 'running'].includes(run.status); i++) { await delay(50); run = await request('calculation-get', { runId: run.runId }) }
    assert.equal(run.status, 'failed'); runs.push(run)
  }
  state = await request('propose', { name: 'A10', reason: '指定历史建议入口' }); const proposalId = state.proposals.at(-1).id
  await request('propose', { name: 'A01S', reason: '较新建议，不应覆盖指定ID' })
  await request('recommend', { names: ['A10', 'A01S'] })
  browser = await chromium.launch({ headless: true, executablePath: process.env.MCHE_BROWSER_EXECUTABLE ?? 'C:/Users/huangyunfei/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe' })
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(10000)
  page.on('pageerror', error => errors.push(error.message)); await page.goto(f.base)
  await page.evaluate(async sessionId => {
    const { createDetailDrawer } = await import('/detail-drawer.js')
    const host = document.createElement('div'); host.id = 'panel-link-checks'; document.body.append(host)
    window.panelCheck = { sessionId, host }
    window.panelCheck.drawer = createDetailDrawer({ session: () => window.panelCheck.sessionId })
  }, sessionId)
  const drawer = page.locator('.detail-drawer').last(), pane = drawer.locator('.detail-entry:not([hidden]) .mche-view')
  const open = async reference => {
    if (await drawer.evaluate(node => node.open)) await drawer.getByRole('button', { name: '关闭详情', exact: true }).click()
    await page.evaluate(reference => {
      const p = window.panelCheck, link = p.drawer.mche({ sessionId: p.sessionId, ...reference })
      p.host.append(link); link.click()
    }, reference)
    await pane.locator(':scope > [role="status"]').filter({ hasText: '已更新。' }).waitFor()
  }
  for (const [view, main] of [['requirements', 'requirements'], ['inputs', 'components'], ['candidates', 'components'], ['selection', 'components'], ['conditions', 'calculation'], ['engineering', 'calculation'], ['preparation', 'calculation'], ['results', 'results']]) {
    await open({ view }); assert.equal(await pane.locator(`[data-main="${main}"]`).getAttribute('aria-current'), 'page')
  }
  for (const [view, name] of [['tube', 'A010S'], ['fin', 'B01'], ['refrigerant', 'R134a']]) {
    await open({ view, name }); assert.match(await pane.innerText(), new RegExp(name)); assert.equal(await pane.locator(`[data-component="${view}"]`).getAttribute('aria-current'), 'page')
  }
  for (const component of ['tube', 'fin', 'refrigerant']) {
    await open({ view: 'catalog', component, query: { limit: 3 } }); assert.equal(await pane.locator('.mche-candidate').count(), 3)
  }
  await open({ view: 'selection', component: 'tube', proposalId })
  assert.equal(await pane.getByRole('button', { name: '确认选择 A10', exact: true }).isVisible(), true)
  checks.push('全部旧视图、三种精确型号/目录及指定proposalId仍正确定位')
  await open({ view: 'conditions', openEditor: true })
  assert.equal(await pane.locator('.mche-flow').evaluate(node => node.classList.contains('flow-enlarged')), true)
  // Simulate the first history page omitting the linked run; its record still comes from the real API.
  await page.route('**/api/mche/case', async route => {
    const response = await route.fetch(), body = await response.json()
    body.calculation.runs = body.calculation.runs.filter(run => run.runId !== runs[0].runId)
    await route.fulfill({ response, json: body })
  })
  await open({ view: 'results', runId: runs[0].runId })
  assert.equal(await pane.locator('.mche-run[data-selected="true"]').isVisible(), true)
  assert.match(await pane.locator('.mche-run[data-selected="true"]').innerText(), /失败/)
  assert.equal(await pane.locator('[data-disclosure="run-history"]').evaluate(node => node.open), false)
  await pane.locator('.mche-run[data-selected="true"]').getByRole('button', { name: '查看本次完整输入及原始结果', exact: true }).click()
  await pane.getByText('原始输出、环境、错误和日志', { exact: true }).click()
  assert.match(await pane.locator('.mche-run[data-selected="true"]').innerText(), /rawResult/)
  await page.screenshot({ path: out + '/native-result-details.png', animations: 'disabled' })
  const nextPage = page.waitForRequest(req => req.url().endsWith('/calculation-get') && req.postDataJSON()?.offset === 1)
  await pane.getByRole('button', { name: '查看更早计算', exact: true }).click(); await nextPage
  await pane.locator(':scope > [role="status"]').filter({ hasText: '已更新。' }).waitFor()
  assert.equal(await pane.locator('.mche-run').count(), 2, 'linked run must not advance the history offset or duplicate rows')
  await page.unroute('**/api/mche/case')
  checks.push('指定真实失败任务可见，其他任务折叠，完整原生输出与日志可访问；显式动画入口直接放大')
  await open({ view: 'inputs', component: 'tube' })
  await pane.getByLabel('管宽约束', { exact: true }).fill('19')
  await request('draft', { changes: { tubeWidth: value(20, 'mm') } })
  await pane.getByRole('button', { name: '保存草稿', exact: true }).click()
  await pane.locator(':scope > [role="status"]').filter({ hasText: /版本|变化|刷新/ }).waitFor()
  assert.equal(await pane.getByLabel('管宽约束', { exact: true }).inputValue(), '19')
  assert.equal(await pane.getAttribute('data-dirty'), 'true')
  assert.equal((await request('case')).draft.tubeWidth.value, 20)
  await open({ view: 'candidates' })
  assert.equal(await pane.getByRole('button', { name: '建议选择 A10', exact: true }).isDisabled(), true)
  assert.match(await pane.innerText(), /已过期|依据已变化/)
  await open({ view: 'inputs', component: 'tube' })
  await pane.getByLabel('管宽约束', { exact: true }).fill('21')
  await page.evaluate(() => { window.panelCheck.sessionId = 'different-session' })
  await pane.getByRole('button', { name: '保存草稿', exact: true }).click()
  await pane.locator(':scope > [role="status"]').filter({ hasText: '会话已切换' }).waitFor()
  assert.equal((await request('case')).draft.tubeWidth.value, 20)
  checks.push('版本冲突保留本地未保存值，候选过期禁用，会话切换拒绝写入')
  assert.deepEqual(errors, [])
  await writeFile(out + '/links.json', JSON.stringify({ passed: true, checks, errors, runs: runs.map(run => ({ runId: run.runId, status: run.status })), at: new Date().toISOString(), syntheticEngineeringInputs: true }, null, 2))
  console.log(checks.join('\n'))
} catch (error) { console.error(error); console.error(errors); process.exitCode = 1; await page?.screenshot({ path: out + '/links-failure.png' }).catch(() => {}) }
finally { await browser?.close(); for (const close of cleanup) await close() }
