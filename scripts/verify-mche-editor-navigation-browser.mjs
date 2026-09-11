// Real browser + isolated DSH runtime with a deterministic local model, not live-provider acceptance.
import { pathToFileURL } from 'node:url'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
import { nativeFixture, post } from '../packages/dsh-excel-understanding/test/native-fixture.js'

const { chromium } = await import(pathToFileURL(process.argv[2] ?? 'C:/Users/huangyunfei/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href)
const out = resolve('docs/verification/evidence/flow-topology/editor-navigation'), cleanup = [], checks = [], errors = [], requests = [], readSessions = []
await mkdir(out, { recursive: true })
const textOf = m => typeof m.content === 'string' ? m.content : (m.content ?? []).filter(b => b.type === 'text').map(b => b.text).join('\n')
const f = await nativeFixture({ after: fn => cleanup.push(fn) }, false, { respond(body) {
  const messages = body.messages ?? []
  const start = messages.findLastIndex(m => m.role === 'user' && /^(看流动动画|仅解释已有动画|编辑器联动验收)/.test(textOf(m)))
  const prompt = start < 0 ? '' : textOf(messages[start])
  if (!prompt.startsWith('看流动动画')) return { delta: { role: 'assistant', content: '流动动画位于 MCHE 方案 → 计算工况。' }, finishReason: 'stop' }
  assert.ok(body.tools.some(t => t.function.name === 'mche_calculation_open_editor'))
  assert.ok(messages.some(m => textOf(m).includes('空流程、管数/方向未填也能打开')))
  if (!messages.slice(start + 1).some(m => m.role === 'tool')) return {
    delta: { role: 'assistant', content: '我来打开流向与拓扑编辑器。', tool_calls: [{ index: 0, id: `flow-open-${messages.length}`,
      type: 'function', function: { name: 'mche_calculation_open_editor', arguments: '{}' } }] }, finishReason: 'tool_calls',
  }
  return { delta: { role: 'assistant', content: '已提供编辑器入口，管数和冷媒方向可以在页面填写。' }, finishReason: 'stop', delayMs: prompt.includes('提前关闭') ? 2500 : 900 }
} })
let browser, context, page
const checked = name => { checks.push(name); console.log(name) }
try {
  const { sessionId } = await post(f, '/api/chat', { prompt: '编辑器联动验收' })
  const before = await post(f, '/api/mche/case', { sessionId })
  browser = await chromium.launch({ headless: true, executablePath: process.env.MCHE_BROWSER_EXECUTABLE ?? 'C:/Users/huangyunfei/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe' })
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, recordVideo: { dir: out, size: { width: 1440, height: 1000 } } })
  page = await context.newPage(); page.setDefaultTimeout(10000)
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => {
    if (!request.url().includes('/api/mche/')) return
    requests.push(new URL(request.url()).pathname); readSessions.push(request.postDataJSON()?.sessionId)
  })
  const drawer = page.locator('#detail-drawer')
  const isOpen = () => drawer.evaluate(el => el.open)
  const send = async text => {
    await page.getByRole('textbox', { name: '输入你的问题' }).fill(text)
    await page.getByRole('button', { name: '发送消息', exact: true }).click()
  }
  const idle = () => page.waitForFunction(() => !document.querySelector('#send').disabled)
  const close = () => page.getByRole('button', { name: '关闭详情', exact: true }).click()
  const flow = () => drawer.locator('.detail-entry:not([hidden]) .mche-flow')
  await page.goto(f.base)
  await page.getByRole('button', { name: '编辑器联动验收', exact: true }).click()
  await idle()
  assert.equal(await isOpen(), false)
  await send('看流动动画：空流程')
  await page.locator('.message.pending .tool-detail-link').waitFor()
  assert.equal(await isOpen(), false, 'streaming result provides a link without opening prematurely')
  await drawer.locator('.detail-close').waitFor(); await flow().waitFor(); await idle()
  assert.equal(await flow().evaluate(el => el.classList.contains('flow-enlarged')), true)
  assert.equal(await drawer.locator('.detail-entry:not([hidden]) [data-view="conditions"]').getAttribute('aria-current'), 'page')
  assert.equal(await page.getByLabel('第1排流程1管数', { exact: true }).inputValue(), '')
  assert.equal(await page.getByLabel('第1排流程1方向', { exact: true }).inputValue(), '')
  assert.equal(await page.getByLabel('第1排流程1管数', { exact: true }).isEnabled(), true)
  const after = await post(f, '/api/mche/case', { sessionId })
  assert.deepEqual(after.calculation, before.calculation); assert.equal(after.revision, before.revision)
  assert.equal(await page.locator('#messages .mche-flow').count(), 0)
  await page.screenshot({ path: out + '/empty-editor-open.png' })
  checked('空管数/方向的单流程随当前回复自动打开；对话侧无动画；工程版本与确认状态不变')
  await close()
  const link = page.locator('.message.assistant .tool-detail-link').last()
  await link.focus(); await page.keyboard.press('Enter'); await flow().waitFor(); await close()
  await page.reload()
  await page.getByRole('button', { name: '编辑器联动验收', exact: true }).click(); await idle()
  assert.equal(await isOpen(), false)
  await page.getByRole('button', { name: '打开流向与拓扑编辑器', exact: true }).click()
  await flow().waitFor(); await close()
  checked('历史恢复只保留可点击入口，不自动弹窗；鼠标和键盘可重开')
  await send('仅解释已有动画'); await idle()
  assert.equal(await isOpen(), false, 'plain text does not act as a navigation command')
  await send('看流动动画：提前关闭')
  const streamingLink = page.locator('.message.pending .tool-detail-link')
  await streamingLink.waitFor(); await streamingLink.click(); await flow().waitFor(); await close(); await idle()
  assert.equal(await isOpen(), false, 'do not reopen a link already dismissed by the user')
  checked('普通说明不触发导航；流式期间手动打开再关闭，回复结束不强行重开')
  // Exercise defensive paths directly through the production view and drawer APIs.
  const guarded = await page.evaluate(async sessionId => {
    const { createChatView } = await import('/chat-view.js'), { createDetailDrawer } = await import('/detail-drawer.js')
    const host = document.createElement('div'); document.querySelector('#messages').append(host)
    const details = createDetailDrawer({ session: () => sessionId }), panel = document.querySelectorAll('#detail-drawer')[1]
    const view = createChatView({ messages: host, details, onUsage() {}, tables: { render(body, text) { body.append(document.createTextNode(text)) } } })
    const navigation = { sessionId, view: 'conditions', openEditor: true }
    const make = (id, mche = navigation, status = 'completed') => {
      const message = view.addMessage('pending', ''), detail = { id, title: '打开编辑器', status, mche }
      view.stream(message, { type: 'detail', detail }); view.stream(message, { type: 'detail', detail })
      view.complete(message, { details: [detail], finalResponse: '请填写。' })
      return message
    }
    const stale = view.openRequestedDetails(make('stale', { ...navigation, sessionId: 'other' }))
    const failed = view.openRequestedDetails(make('failed', navigation, 'failed'))
    const dirtyMessage = make('dirty'), dirtyRoot = panel.querySelector('.mche-view')
    dirtyRoot.dataset.dirty = 'true'
    const dirty = view.openRequestedDetails(dirtyMessage), kept = dirtyRoot.dataset.dirty === 'true'
    dirtyRoot.dataset.dirty = 'false'
    const noLateOpen = view.openRequestedDetails(dirtyMessage)
    const message = make('once')
    let opens = 0; panel.querySelectorAll('.mche-view').forEach(node => node.addEventListener('detail-open', () => opens++))
    const first = view.openRequestedDetails(message), repeated = view.openRequestedDetails(message)
    details.close()
    const dismissed = view.openRequestedDetails(message), closed = !panel.open
    host.remove(); details.reset(); panel.remove()
    return { stale, failed, dirty, kept, noLateOpen, first, repeated, dismissed, closed, opens }
  }, sessionId)
  assert.deepEqual(guarded, { stale: false, failed: false, dirty: false, kept: true, noLateOpen: false, first: true, repeated: false, dismissed: false, closed: true, opens: 1 })
  checked('过期会话、失败结果和未保存草稿不自动导航；重复事件仅打开一次')
  await page.locator('#new-chat').click(); await idle()
  const previousReads = readSessions.length
  assert.equal(await isOpen(), false)
  await page.setViewportSize({ width: 390, height: 844 })
  await send('看流动动画：新会话')
  await drawer.locator('.detail-close').waitFor(); await flow().waitFor(); await idle()
  assert.equal(await page.getByLabel('第1排流程1管数', { exact: true }).inputValue(), '')
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  const freshSessions = [...new Set(readSessions.slice(previousReads))]
  assert.equal(freshSessions.length, 1); assert.ok(freshSessions[0]); assert.notEqual(freshSessions[0], sessionId)
  await page.screenshot({ path: out + '/new-session-mobile.png' })
  await close()
  checked('新会话自动打开自己的空结构；390px窄屏无页面横向溢出')
  assert.ok(requests.every(path => path === '/api/mche/case'), JSON.stringify(requests))
  assert.deepEqual(errors, [])
  await context.close(); context = null
  await page.video().saveAs(out + '/editor-navigation.webm')
  await writeFile(out + '/browser.json', JSON.stringify({ passed: true, at: new Date().toISOString(), provider: 'deterministic local fixture', checks, guarded, errors, requests,
    sessionIsolation: { initial: sessionId, fresh: freshSessions[0] } }, null, 2))
  console.log('BROWSER PASS: explicit chat navigation, empty topology, history, dismissal, guards and session isolation')
} catch (error) {
  console.error(error); console.error(f.output); process.exitCode = 1
  await page?.screenshot({ path: out + '/failure.png' }).catch(() => {})
} finally {
  if (context) await context.close()
  if (browser) await browser.close()
  for (const fn of cleanup) await fn()
}
