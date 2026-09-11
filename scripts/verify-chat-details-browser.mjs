// Uses an existing Playwright installation and an isolated DSH server; no external model calls.
import { pathToFileURL } from 'node:url'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { nativeFixture, post } from '../packages/dsh-excel-understanding/test/native-fixture.js'
import { mockRequirementsResponse } from '../packages/dsh-mche/test/requirements-model-fixture.js'

const { chromium } = await import(process.argv[2] ? pathToFileURL(process.argv[2]).href : 'playwright')
const cleanup = []
const introductions = ['我先读取当前会话的需求文件。', '已找到附件，正在核对当前方案。',
  '现在读取客户需求，保留原始值和来源。', '需求已保存为待核对记录，继续整理 Boundary 建议。']
const f = await nativeFixture({ after: (fn) => cleanup.push(fn) }, false, { respond(body) {
  const reply = mockRequirementsResponse(body)
  if (!reply) return null
  const call = reply.delta.tool_calls?.[0]
  if (call) reply.delta.content = introductions[Number(call.id.split('-').at(-1))]
  return { ...reply, delayMs: 650 }
} })
const evidence = 'docs/verification/evidence'
let browser
try {
  await mkdir(evidence, { recursive: true })
  const { sessionId } = await post(f, '/api/session/prepare', {})
  const bytes = await readFile(new URL('../答复_/3-冷凝器客户输入.xls', import.meta.url))
  const upload = await fetch(f.base + '/api/excel/upload', { method: 'POST', body: bytes, headers: {
    'Content-Type': 'application/octet-stream', 'X-File-Name': 'customer.xls', 'X-Session-Id': sessionId } })
  assert.equal(upload.status, 200)
  await post(f, '/api/chat', { sessionId, prompt: '工具详情浏览器验收' })
  browser = await chromium.launch({ headless: true, timeout: 10000,
    ...(process.env.MCHE_BROWSER_EXECUTABLE ? { executablePath: process.env.MCHE_BROWSER_EXECUTABLE } : {}) })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.setDefaultTimeout(10000)
  const errors = [], writes = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('request', (request) => {
    if (/\/api\/mche\//.test(request.url()) && request.method() === 'POST') writes.push(new URL(request.url()).pathname)
  })
  await page.goto(f.base)
  await page.getByRole('button', { name: '工具详情浏览器验收', exact: true }).click()
  await page.getByRole('textbox', { name: '输入你的问题' }).fill('需求表验收：流式工具详情位置')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  const reply = page.locator('.message.pending').last()
  const firstLink = reply.locator('.tool-detail-link').first()
  await firstLink.waitFor()
  assert.equal(await reply.getAttribute('data-response-state'), 'running')
  assert.equal(await page.locator('#detail-drawer').evaluate((el) => el.open), false)
  assert.ok(['inline', 'inline-block'].includes(await firstLink.evaluate((el) => getComputedStyle(el).display)))
  assert.equal(await firstLink.evaluate((el) => {
    const range = document.createRange(); range.selectNodeContents(el.closest('.response-segment').querySelector('.response-copy'))
    return Math.abs(range.getBoundingClientRect().top - el.getBoundingClientRect().top) < 20
  }), true, '详情入口与对应正文在同一行')
  assert.match(await firstLink.locator('..').locator('..').textContent(), /我先读取当前会话的需求文件/)
  await page.screenshot({ path: `${evidence}/chat-details-streaming.png` })
  await firstLink.click()
  assert.equal(await page.locator('#detail-drawer').evaluate((el) => el.open), true)
  await page.waitForFunction(() => !document.querySelector('.message.pending') && document.querySelector('#messages').getAttribute('aria-busy') === 'false')
  await page.locator('.message.assistant').last().locator('.response-status[data-state="completed"]').waitFor()
  const output = (await post(f, '/api/session/open', { sessionId })).messages.at(-1)
  assert.equal(await page.locator('#detail-drawer').evaluate((el) => el.open), true, '完成时保留已打开的详情')
  await page.getByRole('button', { name: '关闭详情', exact: true }).click()
  const completed = page.locator('.message.assistant').last()
  assert.equal(output.details.length, 4)
  assert.equal(output.segments.length, 5)
  assert.equal(await completed.locator('.tool-detail-link').count(), 4)
  assert.equal(await completed.locator('.response-segment').count(), 5)
  const positions = await completed.locator('.response-segment').evaluateAll((nodes) => nodes.map((node) => ({
    text: node.querySelector('.response-copy').textContent, links: [...node.querySelectorAll('.tool-detail-link')].map((el) => el.textContent) })))
  assert.deepEqual(positions.map((part) => part.links.length), [1, 1, 1, 1, 0])
  await completed.scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${evidence}/chat-details-desktop.png` })
  // Keyboard opening is view-only, and MCHE still exposes the original requirements pane.
  const requirementLink = completed.getByRole('button', { name: '核对客户需求', exact: true })
  await requirementLink.focus(); await page.keyboard.press('Enter')
  await page.getByText('26 条有值记录', { exact: false }).waitFor()
  await page.keyboard.press('Escape')
  assert.equal(await requirementLink.evaluate((el) => el === document.activeElement), true)
  assert.equal(writes.some((path) => /confirm|draft|calculate|requirements-read/.test(path)), false)
  await page.reload()
  await page.getByRole('button', { name: '工具详情浏览器验收', exact: true }).click()
  assert.equal(await completed.locator('.tool-detail-link').count(), 4)
  assert.deepEqual(await completed.locator('.response-segment').evaluateAll((nodes) => nodes.map((n) => n.querySelectorAll('.tool-detail-link').length)), [1, 1, 1, 1, 0])
  assert.match(await completed.locator('.response-status').textContent(), /回复已完成/)
  await page.setViewportSize({ width: 390, height: 844 })
  await completed.scrollIntoViewIfNeeded()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await page.screenshot({ path: `${evidence}/chat-details-mobile.png` })
  // Exercise failure, duplicate events, concurrent tools, truncation, and empty-text tools in the real DOM.
  const edgeCases = await page.evaluate(async () => {
    const { createChatView } = await import('/chat-view.js'), { createDetailDrawer } = await import('/detail-drawer.js')
    const host = document.createElement('div'); document.querySelector('#messages').append(host)
    const details = createDetailDrawer(), view = createChatView({ messages: host, details, onUsage() {}, tables: {
      render(body, text) { const span = document.createElement('span'); span.className = 'message-text'; span.textContent = text; body.append(span) }
    } })
    const message = view.addMessage('pending', '')
    view.stream(message, { type: 'tool', id: 'a' }); view.stream(message, { type: 'tool', id: 'b' })
    const parallel = message.querySelector('.response-status').textContent
    const detail = { id: 'a', status: 'failed', title: '查看读取区域', text: '<script>unsafe</script>' }
    view.stream(message, { type: 'detail', detail }); view.stream(message, { type: 'detail', detail })
    const waiting = message.querySelector('.response-status').textContent
    view.stream(message, { type: 'text', text: '已保留读取失败信息。', segments: [{ id: '1:2', text: '已保留读取失败信息。' }] })
    view.fail(message)
    const failure = { state: message.dataset.responseState, links: message.querySelectorAll('.tool-detail-link').length,
      label: message.querySelector('.tool-detail-link').textContent, body: message.querySelector('.response-copy').textContent }
    message.querySelector('.tool-detail-link').click()
    const safe = !document.querySelector('.detail-entry script') && [...document.querySelectorAll('.detail-text')].some((el) => el.textContent.includes('<script>unsafe</script>'))
    details.close()
    const truncated = view.addMessage('pending', '')
    view.complete(truncated, { finalResponse: '未写完', finishReason: 'max-tokens' })
    const truncation = { state: truncated.dataset.responseState, label: truncated.querySelector('.response-status').textContent }
    const legacy = view.addMessage('pending', '')
    view.complete(legacy, { finalResponse: '旧服务回复', details: [{ ...detail, id: 'legacy', status: 'completed' }] })
    const fallback = legacy.querySelectorAll('.tool-detail-link').length
    host.remove(); details.reset(); document.querySelectorAll('#detail-drawer')[1].remove()
    return { parallel, waiting, failure, safe, truncation, fallback }
  })
  assert.match(edgeCases.parallel, /2 项进行中/); assert.match(edgeCases.waiting, /1 项进行中/)
  assert.equal(edgeCases.failure.state, 'incomplete'); assert.equal(edgeCases.failure.links, 1)
  assert.match(edgeCases.failure.label, /失败/); assert.match(edgeCases.failure.body, /已保留/)
  assert.equal(edgeCases.safe, true); assert.equal(edgeCases.truncation.state, 'incomplete')
  assert.match(edgeCases.truncation.label, /输出上限/); assert.equal(edgeCases.fallback, 1)
  assert.deepEqual(errors, [])
  await writeFile(`${evidence}/chat-details-browser.json`, JSON.stringify({ passed: true, segments: positions,
    edgeCases, errors, requests: writes, desktop: [1440, 1000], mobile: [390, 844] }, null, 2))
  console.log('BROWSER PASS: streaming inline links, completion, drawer retention, keyboard, history, mobile, failure/truncation, view-only details.')
} catch (error) { console.error(error); process.exitCode = 1 }
finally { if (browser) await browser.close(); for (const fn of cleanup) await fn() }
