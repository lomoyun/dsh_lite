import { createWorkbookView } from './workbook-view.js'
import { createMcheView } from './mche-view.js'

function node(tag, className, text) {
  const element = document.createElement(tag)
  element.className = className
  if (text) element.textContent = text
  return element
}

export function createDetailDrawer({ session = () => undefined, writable = () => true, mcheWritable = writable } = {}) {
  const entries = new Map()
  const opened = new WeakSet()
  const dialog = node('dialog', 'detail-drawer'), heading = node('h2', '', '详情')
  dialog.id = 'detail-drawer'; heading.id = 'detail-heading'
  dialog.setAttribute('aria-labelledby', heading.id)
  const header = node('div', 'detail-header'), content = node('div', 'detail-content')
  const close = node('button', 'detail-close', '×')
  close.type = 'button'; close.setAttribute('aria-label', '关闭详情')
  close.addEventListener('click', () => dialog.close())
  header.append(heading, close); dialog.append(header, content); document.body.append(dialog)
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close() })
  function link(title, element) {
    const entry = node('section', 'detail-entry'); entry.append(element); entry.hidden = true; content.append(entry)
    const button = node('button', 'detail-link', title)
    entries.set(button, entry)
    button.type = 'button'; button.setAttribute('aria-haspopup', 'dialog'); button.setAttribute('aria-controls', dialog.id)
    button.addEventListener('click', () => {
      opened.add(button)
      for (const item of content.children) item.hidden = item !== entry
      heading.textContent = title
      if (!dialog.open) dialog.showModal()
      element.dispatchEvent(new Event('detail-open'))
      content.scrollTop = 0; close.focus()
    })
    return button
  }
  function tools(body, details = []) {
    for (const detail of details) body.append(tool(detail))
  }
  function tool(detail) {
    let button
    if (detail.mche) button = link(detail.title, createMcheView({ reference: detail.mche, session, writable: mcheWritable }))
    else if (detail.excel?.fileId) button = workbook(detail.excel, detail.title)
    else {
      const text = node('pre', 'detail-text', `${detail.status === 'failed' ? '工具执行失败\n\n' : ''}${detail.text || '该工具未返回可展示的文字。'}${detail.truncated ? '\n\n内容较长，当前显示前 20000 字。' : ''}`)
      button = link(detail.title, text)
    }
    button.classList.add('tool-detail-link')
    button.dataset.toolId = detail.id
    button.dataset.status = detail.status
    button.textContent = `${detail.title}${detail.status === 'failed' ? ' · 失败' : ''}`
    button.title = `${detail.status === 'failed' ? '本次工具调用失败' : '本次工具调用已返回'}，点击查看详情`
    return button
  }
  function workbook(file, title = `查看工作簿：${file.name ?? 'Excel 理解结果'}`) {
    return link(title, createWorkbookView({ file, session }))
  }
  function openRequested(button, reference) {
    // Only an explicit, current-session tool request can open a panel automatically.
    // Keep local edits in place; the response link remains available for later use.
    const entry = entries.get(button)
    if (!entry || !button.isConnected || reference?.openEditor !== true || reference.view !== 'conditions' ||
      !reference.sessionId || reference.sessionId !== session() || content.querySelector('.mche-view[data-dirty="true"]')) return false
    // A user who already opened and dismissed this link should not see it reopen.
    if (!opened.has(button) && (!dialog.open || entry.hidden)) button.click()
    return dialog.open && !entry.hidden
  }
  return { link, tools, tool, workbook, mche: (reference = {}) => link('MCHE 方案',createMcheView({reference,session,writable:mcheWritable})),
    openRequested,
    hasUnsaved: () => Boolean(content.querySelector('.mche-view[data-dirty="true"]')),
    setBusy: () => content.querySelectorAll('.mche-view').forEach((item) => item.dispatchEvent(new Event('mche-busy'))),
    close: () => dialog.close(), prune() {
    for (const [button, entry] of entries) {
      if (button.isConnected) continue
      if (!entry.hidden && dialog.open) dialog.close()
      entry.firstElementChild?.dispatchEvent(new Event('dispose')); entry.remove(); entries.delete(button)
    }
  }, reset() {
    dialog.close()
    for (const entry of content.children) entry.firstElementChild?.dispatchEvent(new Event('dispose'))
    content.replaceChildren(); entries.clear()
  } }
}

export function codeParts(text) {
  const parts = [], expression = /^```([^\n]*)\n([\s\S]*?)(?:^```\s*$|$(?![\s\S]))/gm
  let offset = 0
  for (const match of text.matchAll(expression)) {
    if (match.index > offset) parts.push({ type: 'text', text: text.slice(offset, match.index) })
    parts.push({ type: 'code', title: match[1].trim() ? `查看 ${match[1].trim()} 内容` : '查看详细内容', text: match[2] })
    offset = match.index + match[0].length
  }
  if (offset < text.length) parts.push({ type: 'text', text: text.slice(offset) })
  return parts
}
