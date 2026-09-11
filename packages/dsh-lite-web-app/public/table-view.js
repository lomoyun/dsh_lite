import { normalizeTables, tableToTsv, TABLE_LIMITS } from './table-data.js'

const PAGE_SIZE = 20
const element = (tag, text, className) => {
  const node = document.createElement(tag)
  if (text !== undefined) node.textContent = text
  if (className) node.className = className
  return node
}

function action(text, handler) {
  const button = element('button', text)
  button.type = 'button'
  button.addEventListener('click', handler)
  return button
}

function editableCell({ value, label, change, heading = false }) {
  const input = document.createElement(heading ? 'input' : 'textarea')
  input.value = value
  input.maxLength = TABLE_LIMITS.cellText
  input.setAttribute('aria-label', label)
  if (!heading) input.rows = 1
  input.addEventListener('input', () => change(input.value))
  return input
}

function renderHeader(state, changed) {
  const row = element('tr')
  row.append(element('th', '#'))
  state.table.columns.forEach((column, index) => {
    const cell = element('th')
    cell.scope = 'col'
    if (state.editing) cell.append(editableCell({ value: column, label: `第 ${index + 1} 列表头`, change: (value) => {
      state.table.columns[index] = value; changed()
    }, heading: true }))
    else cell.textContent = column || `未命名列 ${index + 1}`
    row.append(cell)
  })
  if (state.editing) row.append(element('th', '操作'))
  return row
}

function renderRow({ state, index, changed, refresh }) {
  const row = element('tr')
  const number = element('th', String(index + 1))
  number.scope = 'row'
  row.append(number)
  state.table.rows[index].forEach((value, column) => {
    const cell = element('td')
    if (state.editing) cell.append(editableCell({ value, label: `第 ${index + 1} 行，第 ${column + 1} 列`, change: (next) => {
      state.table.rows[index][column] = next; changed()
    } }))
    else { cell.textContent = value; if (!value) cell.setAttribute('aria-label', '空值') }
    row.append(cell)
  })
  if (state.editing) {
    const cell = element('td')
    const remove = action('移除行', () => { state.table.rows.splice(index, 1); changed(); refresh() })
    remove.setAttribute('aria-label', `移除第 ${index + 1} 行`)
    cell.append(remove); row.append(cell)
  }
  return row
}

export function createTableCard(input, options = {}) {
  const baseline = normalizeTables([input])[0]
  const state = { table: normalizeTables([input])[0], editing: false, page: 0,
    dirty: Boolean(options.draft), busy: false, readOnly: false }
  const card = element('section', undefined, 'table-card')
  card.setAttribute('aria-label', state.table.title)
  const head = element('div', undefined, 'table-card-head')
  const title = element('strong', state.table.title)
  const badge = element('span', options.draft ? '待发送' : options.confirmed ? '已发送' : '待核对', 'table-badge')
  head.append(title, badge)
  const source = element('p', state.table.source || '来自本轮对话', 'table-source')
  const notice = element('p', state.table.warnings.join(' '), 'table-notice')
  const scroll = element('div', undefined, 'table-scroll')
  scroll.tabIndex = 0
  scroll.setAttribute('role', 'region'); scroll.setAttribute('aria-label', `${state.table.title}，可横向滚动`)
  const table = element('table')
  const caption = element('caption', `${state.table.title}；空白单元格表示未提供`, 'sr-only')
  table.append(caption)
  scroll.append(table)
  const footer = element('div', undefined, 'table-card-actions')
  const status = element('span', '', 'table-count')
  const feedback = element('p', '', 'table-feedback')
  feedback.setAttribute('role', 'status')
  const changed = () => { state.dirty = true; badge.textContent = '修改待发送'; options.onChange?.() }
  const refresh = () => renderGrid({ state, table, status, footer, refresh, changed })
  const saved = () => { state.dirty = false; badge.textContent = '本次编辑已发送'; options.onChange?.() }
  const revert = () => {
    state.table = structuredClone(baseline); state.dirty = Boolean(options.draft)
    badge.textContent = options.draft ? '待发送' : options.confirmed ? '已发送' : '待核对'
    feedback.textContent = '已恢复原始表格。'; refresh(); options.onChange?.()
  }
  const buttons = createActions({ state, refresh, changed, options, feedback, saved, revert })
  footer.append(status, ...buttons)
  card.append(head, source, notice, scroll, footer, feedback)
  refresh()
  return { element: card, getTable: () => normalizeTables([state.table])[0],
    dirty: () => state.dirty,
    saved,
    setBusy(value, readOnly = false) {
      state.busy = value; state.readOnly = readOnly
      if (readOnly) state.editing = false
      refresh()
      for (const control of card.querySelectorAll('button,input,textarea')) {
        control.disabled = value || (readOnly && !control.dataset.local)
      }
    } }
}

function renderGrid({ state, table, status, footer, refresh, changed }) {
  const pages = Math.max(1, Math.ceil(state.table.rows.length / PAGE_SIZE))
  state.page = Math.min(state.page, pages - 1)
  table.querySelector('thead')?.remove(); table.querySelector('tbody')?.remove()
  const head = element('thead'), body = element('tbody')
  head.append(renderHeader(state, changed))
  const start = state.page * PAGE_SIZE
  for (let index = start; index < Math.min(start + PAGE_SIZE, state.table.rows.length); index++) {
    body.append(renderRow({ state, index, changed, refresh }))
  }
  table.append(head, body)
  status.textContent = `${state.table.rows.length} 行 × ${state.table.columns.length} 列 · ${state.page + 1}/${pages} 页`
  footer.querySelector('.table-pages')?.remove()
  if (pages > 1) {
    const nav = element('span', undefined, 'table-pages')
    const previous = action('上一页', () => { state.page--; refresh() })
    const next = action('下一页', () => { state.page++; refresh() })
    previous.disabled = state.page === 0 || state.busy; next.disabled = state.page === pages - 1 || state.busy
    nav.append(previous, next); footer.append(nav)
  }
}

function createActions({ state, refresh, changed, options, feedback, saved, revert }) {
  const edit = action('编辑表格', () => {
    state.editing = !state.editing; edit.textContent = state.editing ? '结束编辑' : '编辑表格'; add.hidden = !state.editing; refresh()
  })
  const add = action('添加行', () => {
    if (state.table.rows.length >= TABLE_LIMITS.rows) { feedback.textContent = `最多 ${TABLE_LIMITS.rows} 行`; return }
    state.table.rows.push(state.table.columns.map(() => ''))
    state.page = Math.floor((state.table.rows.length - 1) / PAGE_SIZE); changed(); refresh()
  })
  add.hidden = true
  const copy = action('复制表格', async () => {
    try { await navigator.clipboard.writeText(tableToTsv(state.table)); feedback.textContent = '已复制，可粘贴到 Excel。' }
    catch { feedback.textContent = '复制失败，请检查浏览器剪贴板权限。' }
  })
  const undo = action('撤销修改', revert)
  undo.dataset.local = 'true'; copy.dataset.local = 'true'
  const buttons = [edit, add, undo, copy]
  if (options.onConfirm) buttons.push(action('确认并发送', async () => {
    try {
      const [table] = normalizeTables([state.table])
      if (await options.onConfirm(table)) { saved(); feedback.textContent = '已作为新消息发送，原消息保留。' }
    } catch (error) { feedback.textContent = error.message }
  }))
  return buttons
}
