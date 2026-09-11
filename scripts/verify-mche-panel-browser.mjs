// Real Chromium against an isolated runtime; deterministic model, no live-provider claims.
import { pathToFileURL } from 'node:url'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { nativeFixture, post } from '../packages/dsh-excel-understanding/test/native-fixture.js'
import { mockRequirementsResponse } from '../packages/dsh-mche/test/requirements-model-fixture.js'

const { chromium } = await import(pathToFileURL('C:/Users/huangyunfei/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href)
const out = 'docs/verification/evidence/mche-detail-panel', cleanup = [], checks = [], errors = [], writes = []
const before = process.argv.includes('--before')
await mkdir(out, { recursive: true })
const f = await nativeFixture({ after: fn => cleanup.push(fn) }, false, { respond: mockRequirementsResponse })
let browser, page
const checked = label => { checks.push(label); console.log(label) }
try {
  const { sessionId } = await post(f, '/api/session/prepare', {})
  const upload = await fetch(f.base + '/api/excel/upload', { method: 'POST', body: await readFile('答复_/3-冷凝器客户输入.xls'),
    headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': 'customer.xls', 'X-Session-Id': sessionId } })
  assert.equal(upload.status, 200); const { file } = await upload.json()
  await post(f, '/api/chat', { sessionId, prompt: '需求表验收：读取客户需求并给出Boundary建议。', workbooks: [file] })
  const request = (path, body = {}) => post(f, '/api/mche/' + path, { sessionId, ...body })
  let state = await request('case')
  browser = await chromium.launch({ headless: true, executablePath: process.env.MCHE_BROWSER_EXECUTABLE ?? 'C:/Users/huangyunfei/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe' })
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(10000)
  if (before) await page.route(/\/(mche[^/]*\.(?:js|css)|flow-topology\.js)$/, async route => {
    const name = new URL(route.request().url()).pathname.split('/').at(-1)
    await route.fulfill({ body: await readFile('.dsh/mche-detail-before/' + name), contentType: name.endsWith('.css') ? 'text/css' : 'application/javascript' })
  })
  page.on('pageerror', e => errors.push(e.message))
  page.on('request', req => { if (/\/api\/mche\//.test(req.url()) && !req.url().endsWith('/case')) writes.push(req.url().split('/').at(-1)) })
  await page.goto(f.base)
  await page.getByRole('button', { name: '需求表验收：读取客户需求并', exact: true }).click()
  await page.getByRole('button', { name: 'MCHE 方案', exact: true }).click()
  const pane = page.locator('#detail-drawer .detail-entry:not([hidden]) .mche-view')
  const nav = name => pane.getByRole('button', { name, exact: true }).click()
  const idle = () => page.waitForFunction(() => [...document.querySelectorAll('.detail-entry:not([hidden]) .mche-view > [role="status"]')].some(el => el.textContent === '已更新。'))
  const reveal = async locator => {
    for (const ancestor of await locator.locator('xpath=ancestor::details').all()) {
      if (!await ancestor.evaluate(el => el.open)) await ancestor.locator(':scope > summary').click()
    }
  }
  if (before) {
    await nav('客户需求'); await idle()
    await page.screenshot({ animations: 'disabled', path: out + '/before-requirements.png' })
    await nav('计算工况'); await idle()
    await page.screenshot({ animations: 'disabled', path: out + '/before-conditions.png' })
    await page.setViewportSize({ width: 390, height: 844 })
    await nav('客户需求'); await idle()
    await page.screenshot({ animations: 'disabled', path: out + '/before-mobile.png' })
    checked('baseline screenshots from preserved pre-change frontend')
  } else {
    await idle()
    assert.deepEqual(await pane.locator('.mche-mainnav button').allTextContents(), ['需求', '部件', '计算', '结果'])
    assert.equal(await pane.locator('[data-main="requirements"]').getAttribute('aria-current'), 'page')
    assert.equal(await pane.locator('.mche-components').isVisible(), false)
    assert.equal(await pane.locator('.mche-current-issues > .mche-guidance-issue').count() <= 3, true)
    assert.equal(await pane.locator('pre:visible').count(), 0)
    assert.equal(await pane.locator('[data-record-id]').count(), 26)
    assert.equal(await pane.locator('[data-disclosure="records-test"]').evaluate(el => el.open), false)
    assert.equal(await pane.locator('[data-disclosure="records-requirements"]').evaluate(el => el.open), false)
    assert.equal(await pane.getByRole('button', { name: '确认需求并应用当前工况草稿', exact: true }).isVisible(), false)
    const layout = async () => pane.evaluate(root => {
      const body = root.querySelector('.mche-body'), footer = root.querySelector('.mche-actions'), nav = root.querySelector('.mche-mainnav')
      const b = body.getBoundingClientRect(), f = footer.getBoundingClientRect(), n = nav.getBoundingClientRect()
      return { overflow: body.scrollWidth > body.clientWidth, pageOverflow: document.documentElement.scrollWidth > innerWidth,
        footerVisible: f.bottom <= innerHeight && f.top >= b.bottom - 1, navVisible: n.bottom <= b.top,
        width: Math.round(root.closest('dialog').getBoundingClientRect().width) }
    })
    assert.deepEqual(await layout(), { overflow: false, pageOverflow: false, footerVisible: true, navVisible: true, width: 660 })
    await page.screenshot({ animations: 'disabled', path: out + '/after-requirements.png' })
    checked('四主入口、26条记录、默认折叠证据、固定导航与操作区')

    // Inspect every retained source record through its own evidence disclosure.
    for (const record of state.requirements.document.records) {
      const row = pane.locator(`[data-record-id="${record.id}"]`)
      await reveal(row); const evidence = row.locator('details').first()
      if (!await evidence.evaluate(el => el.open)) await evidence.locator('summary').click()
      const original = JSON.parse(await evidence.locator('pre').textContent())
      assert.deepEqual(original.raw, record.raw); assert.equal(original.display, record.display)
      assert.deepEqual(original.source, record.source); assert.deepEqual(original.unitCandidates, record.unitCandidates)
      await evidence.locator('summary').click()
    }
    assert.equal(writes.length, 0, 'disclosures never save')
    checked('26条记录逐项展开：原始值、显示值、单位候选、来源坐标均保留')
    const mode = pane.getByLabel('冷媒模式', { exact: true }); await reveal(mode)
    await nav('采用推荐作为草稿'); await idle()
    const fill = async (label, value, source) => {
      const input = pane.getByLabel(label + '采用值', { exact: true }); await reveal(input); await input.fill(value)
      if (source !== undefined) { const basis = pane.getByLabel(label + '依据', { exact: true }); await reveal(basis); await basis.fill(source) }
    }
    await fill('积尘要求', 'No - panel verification', '浏览器隔离验收')
    await pane.locator('[data-disclosure="records-requirements"] > summary').click()
    await nav('部件')
    assert.match(await pane.locator(':scope > [role="status"]').innerText(), /请先保存/)
    assert.equal(await pane.getByLabel('积尘要求采用值', { exact: true }).inputValue(), 'No - panel verification')
    await nav('保存需求草稿'); await idle()
    state = await request('case')
    assert.equal(state.requirements.assessment.rows.find(r => r.key === 'dustRequirement')?.current?.value ?? state.requirements.assessment.rows.find(r => r.current?.value === 'No - panel verification')?.current.value, 'No - panel verification')
    assert.equal(await pane.locator('[data-disclosure="records-requirements"]').evaluate(el => el.open), false)
    await fill('空气入口绝对压力', '101.325', '')
    const source = pane.getByLabel('空气入口绝对压力依据', { exact: true })
    await source.locator('xpath=ancestor::details[1]').locator('summary').click()
    await nav('保存需求草稿')
    await pane.locator(':scope > [role="status"]').filter({ hasText: '请填写空气入口绝对压力' }).waitFor()
    assert.equal(await source.isVisible(), true)
    assert.equal(await pane.evaluate(el => el.contains(document.activeElement)), true)
    await source.fill('浏览器隔离验收'); await nav('保存需求草稿'); await idle()
    checked('折叠不丢编辑、不自动保存，未保存跳转保护、保存恢复折叠、缺依据自动展开')

    const writesBefore = writes.filter(p => p === 'requirements-confirm').length
    await nav('核对并确认')
    assert.equal(await pane.locator('[data-disclosure="requirements-confirmation"]').evaluate(el => el.open), true)
    assert.equal(writes.filter(p => p === 'requirements-confirm').length, writesBefore)
    await nav('确认需求并应用当前工况草稿'); await idle()
    state = await request('case'); assert.equal(state.requirements.reviewed, true)
    assert.equal(state.calculation.requirementsSnapshot.entries.refSuperheat.normalized, 27.4)
    assert.equal(state.calculation.requirementsSnapshot.entries.airTemperature.normalized, 305.15)
    checked('核对仅展开差异，第二次明确确认才写接口；SH与主工况快照保留')

    await nav('计算'); await idle()
    assert.equal(await pane.locator('[data-view="conditions"]').getAttribute('aria-current'), 'page')
    assert.equal(await pane.locator('.mche-profile').count(), 0)
    assert.equal(await pane.locator('.flow-stage').evaluate(el => el.getBoundingClientRect().height), 220)
    assert.equal(await page.locator('#detail-drawer').evaluate(el => el.getBoundingClientRect().width), 660)
    assert.equal(await pane.getByLabel('播放速度', { exact: true }).isVisible(), false)
    await pane.locator('.mche-body').evaluate(el => el.scrollTop = 0)
    await page.screenshot({ animations: 'disabled', path: out + '/after-conditions.png' })
    await nav('放大查看')
    assert.equal(await page.locator('#detail-drawer').evaluate(el => el.getBoundingClientRect().width), 1100)
    await pane.getByLabel('播放速度', { exact: true }).selectOption('2')
    await nav('暂停'); await nav('展开各排')
    await page.screenshot({ animations: 'disabled', path: out + '/after-expanded.png' })
    await nav('需求'); await idle(); await nav('计算'); await idle()
    assert.equal(await pane.getByLabel('播放速度', { exact: true }).inputValue(), '2')
    assert.equal(await pane.getByRole('button', { name: '整体视图', exact: true }).isVisible(), true)
    await nav('收起放大')
    assert.equal(await page.locator('#detail-drawer').evaluate(el => el.getBoundingClientRect().width), 660)
    await nav('工程核对'); await idle(); await nav('部件'); await idle()
    assert.equal(await pane.locator('[data-view="candidates"]').getAttribute('aria-current'), 'page')
    await nav('翅片'); await idle(); await nav('选型条件'); await idle()
    await nav('计算'); await idle()
    assert.equal(await pane.locator('[data-view="engineering"]').getAttribute('aria-current'), 'page')
    await nav('部件'); await idle()
    assert.equal(await pane.locator('[data-component="fin"]').getAttribute('aria-current'), 'page')
    assert.equal(await pane.locator('[data-view="inputs"]').getAttribute('aria-current'), 'page')
    checked('默认紧凑流图、放大完整控制、播放偏好和入口内位置恢复')

    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 })
      for (const main of ['需求', '部件', '计算', '结果']) {
        await nav(main); await idle()
        if (main === '需求') {
          const modes = pane.locator('[data-disclosure="boundary-modes"]')
          if (await modes.evaluate(el => el.open)) await modes.locator(':scope > summary').click()
        }
        const info = await layout(); assert.equal(info.overflow, false, main); assert.equal(info.pageOverflow, false, main)
        await pane.locator('.mche-body').evaluate(el => el.scrollTop = 0)
        if (main === '需求' || main === '计算') await page.screenshot({ animations: 'disabled', path: `${out}/after-${width}-${main === '需求' ? 'requirements' : 'engineering'}.png` })
      }
      await nav('计算'); await idle(); await nav('工况与结构'); await idle()
      assert.equal((await layout()).overflow, false)
      await page.screenshot({ animations: 'disabled', path: `${out}/after-${width}-flow.png` })
    }
    await page.emulateMedia({ reducedMotion: 'reduce' })
    assert.equal(await pane.getByRole('button', { name: '系统已减少动态', exact: true }).isDisabled(), true)
    await pane.locator('[data-main="requirements"]').focus(); await page.keyboard.press('Enter'); await idle()
    await pane.locator('[data-disclosure="all-status"] > summary').focus(); await page.keyboard.press('Enter')
    assert.equal(await pane.locator('[data-disclosure="all-status"]').evaluate(el => el.open), true)
    await page.keyboard.press('Escape'); assert.equal(await page.locator('#detail-drawer').evaluate(el => el.open), false)
    checked('桌面与390px全部入口无横向溢出；键盘导航/展开/关闭及减少动态通过')
    assert.deepEqual(errors, [])
  }
  await writeFile(`${out}/${before ? 'before' : 'browser'}.json`, JSON.stringify({ passed: true, checks, errors, writes, at: new Date().toISOString(), provider: 'deterministic local fixture' }, null, 2))
} catch (error) {
  console.error(error); console.error(errors); process.exitCode = 1
  await page?.screenshot({ path: out + '/failure.png' }).catch(() => {})
} finally { await browser?.close(); for (const close of cleanup) await close() }
