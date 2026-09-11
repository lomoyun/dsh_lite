// Deterministic setup + real browser, separate from live-model acceptance.
import { pathToFileURL } from 'node:url'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import assert from 'node:assert/strict'
import { reveal, navigate } from './mche-browser-helpers.mjs'
import { nativeFixture, post } from '../packages/dsh-excel-understanding/test/native-fixture.js'
import { mockRequirementsResponse } from '../packages/dsh-mche/test/requirements-model-fixture.js'
const { chromium } = await import(pathToFileURL(process.argv[2] ?? 'C:/Users/huangyunfei/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href)
const cleanup = [], out = resolve('docs/verification/evidence/engineering-guidance/browser'), checks = [], errors = []
await mkdir(out, { recursive: true })
const f = await nativeFixture({ after: fn => cleanup.push(fn) }, false, { respond: mockRequirementsResponse })
let browser, page
try {
  const { sessionId } = await post(f, '/api/session/prepare', {})
  const upload = await fetch(f.base + '/api/excel/upload', { method: 'POST', body: await readFile('答复_/3-冷凝器客户输入.xls'),
    headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': 'customer.xls', 'X-Session-Id': sessionId } })
  const { file } = await upload.json(); assert.equal(upload.status, 200)
  await post(f, '/api/chat', { sessionId, prompt: '需求表验收：读取客户需求并给出Boundary建议。', workbooks: [file] })
  const request = (path, body = {}) => post(f, '/api/mche/' + path, { sessionId, ...body })
  let state = await request('case')
  for (const [propose, confirm, name] of [['propose', 'confirm-tube', 'A10'], ['fin-propose', 'confirm-fin', 'B04']]) {
    state = await request(propose, { name, reason: '浏览器验收指定型号，适用性未验证', revision: state.revision })
    state = await request(confirm, { proposalId: state.proposals.at(-1).id, revision: state.revision })
  }
  state = await request('recommend', { names: ['A10', 'A01S'] })
  browser = await chromium.launch({ headless: true, executablePath: process.env.MCHE_BROWSER_EXECUTABLE ?? 'C:/Users/huangyunfei/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe' })
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(10000)
  page.on('pageerror', e => errors.push(e.message))
  await page.goto(f.base)
  await page.getByRole('button', { name: '需求表验收：读取客户需求并', exact: true }).click()
  await page.getByRole('button', { name: 'MCHE 方案', exact: true }).click()
  const pane = () => page.locator('#detail-drawer .detail-entry:not([hidden])')
  await pane().locator('.mche-guidance').waitFor()
  assert.equal(await pane().locator('[data-guidance-group]').count(), 4)
  await reveal(pane().locator('[data-guidance-group="engineering"]'))
  assert.match(await pane().locator('.mche-guidance').innerText(), /NaN/)
  const before = await request('case')
  await pane().locator('[data-guidance-group="engineering"] > summary').click()
  await pane().locator('[data-guidance-group="engineering"] button').first().click()
  await pane().getByLabel('DLL 翅片高度取值', { exact: true }).waitFor()
  assert.match(await pane().getByLabel('DLL 翅片高度取值', { exact: true }).innerText(), /焊前高度 · 原值 6.53 mm/)
  assert.match(await pane().getByLabel('DLL 开窗长度取值', { exact: true }).innerText(), /Full · 原值 4.9 mm/)
  assert.equal((await request('case')).revision, before.revision)
  checks.push('统一四类待办、能力限制及只读入口；语义选项保留原值单位')
  await navigate(page, '候选比较')
  await pane().getByText('服务端比较依据', { exact: true }).click()
  await pane().getByText('服务端比较依据', { exact: true }).waitFor()
  assert.match(await pane().locator('.mche-recommendation-basis').innerText(), /不能证明项目适用性/)
  await pane().locator('.mche-guidance').scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(out, 'shared-state.png') })
  await request('draft', { changes: { tubeWidth: { value: 20, unit: 'mm', source: '用户明确宽度约束20mm' } } })
  await pane().getByRole('button', { name: '候选比较', exact: true }).click()
  await pane().getByText('需求、约束或已选部件依据已变化，请重新比较。', { exact: true }).waitFor()
  assert.equal(await pane().getByRole('button', { name: '建议选择 A10', exact: true }).isDisabled(), true)
  checks.push('旧候选依据独立保留，明确约束变化使推荐过期')
  await navigate(page, '客户需求')
  await reveal(pane().getByText('其他模式的未填字段（非当前必填）', { exact: true }).first())
  await pane().getByText('其他模式的未填字段（非当前必填）', { exact: true }).first().waitFor()
  await reveal(pane().getByRole('button', { name: '采用推荐作为草稿', exact: true }))
  await pane().getByRole('button', { name: '采用推荐作为草稿', exact: true }).click()
  await page.waitForFunction(() => [...document.querySelectorAll('.mche-view')].some(e => e.textContent.includes('已更新。')))
  state = await request('case'); assert.equal(state.requirements.boundary.refrigerant, 'ptsc')
  await page.locator('#detail-drawer .detail-close').click(); await page.reload()
  await page.getByRole('button', { name: '需求表验收：读取客户需求并', exact: true }).click()
  assert.equal(await page.locator('#detail-drawer').evaluate(e => e.open), false)
  await page.getByRole('button', { name: 'MCHE 方案', exact: true }).click()
  await navigate(page, '客户需求')
  assert.equal(await pane().getByLabel('冷媒模式', { exact: true }).inputValue(), 'ptsc')
  await page.setViewportSize({ width: 390, height: 844 })
  await pane().locator('.mche-guidance').scrollIntoViewIfNeeded()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await page.screenshot({ path: join(out, 'mobile-state.png') })
  checks.push('推荐模式保存、刷新恢复、历史不自动打开、390px适配')
  assert.deepEqual(errors, [])
  await writeFile(join(out, 'browser.json'), JSON.stringify({ passed: true, provider: 'deterministic local fixture', checks, errors }, null, 2))
  console.log('PASS: ' + checks.join('；'))
} catch (e) { console.error(e); process.exitCode = 1; await page?.screenshot({ path: join(out, 'failure.png') }).catch(() => {}) }
finally { await browser?.close(); for (const close of cleanup) await close() }
