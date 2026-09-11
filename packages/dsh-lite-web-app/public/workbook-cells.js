const PAGE_ROWS = 40, PAGE_COLUMNS = 12
function node(tag, text = '') { const el = document.createElement(tag); el.textContent = text; return el }
function point(address) {
  const [, letters, row] = /^([A-Z]+)(\d+)$/.exec(address)
  return { row: Number(row), col: [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) }
}
function column(value) {
  let text = ''
  while (value) { text = String.fromCharCode(65 + (value - 1) % 26) + text; value = Math.floor((value - 1) / 26) }
  return text
}
export function createCellView({ sheets, read, focus }) {
  const root = node('section'), controls = node('form'), select = node('select'), range = node('input'), load = node('button', '读取区域')
  const status = node('p'), container = node('div'), info = node('pre'), pages = node('div')
  container.className = 'workbook-grid'; container.tabIndex = 0; container.setAttribute('aria-label', '工作表单元格，可横向滚动')
  info.className = 'workbook-cell-info'; status.setAttribute('role', 'status')
  select.setAttribute('aria-label', '选择 Sheet'); range.setAttribute('aria-label', '单元格范围'); load.type = 'submit'
  for (const sheet of sheets) select.add(new Option(`${sheet.name}${sheet.hidden ? '（隐藏）' : ''}`, sheet.name))
  if (focus?.sheet) select.value = focus.sheet
  let page = 0, colPage = 0, request = 0
  function defaultRange() {
    const sheet = sheets.find((s) => s.name === select.value)
    if (!sheet?.indexedRange) return ''
    const [first, last = first] = sheet.indexedRange.split(':'), start = point(first), end = point(last)
    const row = Math.min(end.row, start.row + page * PAGE_ROWS), col = Math.min(end.col, start.col + colPage * PAGE_COLUMNS)
    return `${column(col)}${row}:${column(Math.min(end.col, col + PAGE_COLUMNS - 1))}${Math.min(end.row, row + PAGE_ROWS - 1)}`
  }
  async function render() {
    if (!range.value) { status.textContent = '此 Sheet 没有可读取的索引区域。'; container.replaceChildren(); return }
    const current = ++request; status.textContent = '正在读取…'; load.disabled = true
    try {
      const result = await read({ sheet: select.value, range: range.value.toUpperCase() })
      if (current !== request) return
      status.textContent = `${select.value} · ${result.returnedRange}${result.partial ? ' · 本次仅返回部分区域，请继续分页' : ''}`
      container.replaceChildren(grid(result, info)); info.textContent = '点击单元格查看原始值、公式和批注。'
    } catch (error) { if (current === request) status.textContent = error.message }
    finally { if (current === request) load.disabled = false }
  }
  select.addEventListener('change', () => { page = 0; colPage = 0; range.value = defaultRange(); void render() })
  controls.addEventListener('submit', (event) => { event.preventDefault(); void render() })
  for (const [label, change] of [['上一页', () => { page = Math.max(0, page - 1) }], ['下一页', () => { page++ }],
    ['前一组列', () => { colPage = Math.max(0, colPage - 1) }], ['后一组列', () => { colPage++ }]]) {
    const button = node('button', label); button.type = 'button'
    button.addEventListener('click', () => { change(); range.value = defaultRange(); void render() }); pages.append(button)
  }
  controls.append(select, range, load); controls.className = 'workbook-controls'; pages.className = 'workbook-controls'
  root.append(controls, status, container, pages, info)
  range.value = focus?.range ?? defaultRange(); void render()
  return root
}
function grid(result, info) {
  const table = node('table'), head = node('tr'), body = node('tbody')
  const [first, last = first] = result.returnedRange.split(':'), start = point(first), end = point(last)
  const cells = new Map(result.cells.map((cell) => [cell.address, cell]))
  head.append(node('th', '行 / 列'))
  for (let col = start.col; col <= end.col; col++) { const th = node('th', column(col)); th.scope = 'col'; head.append(th) }
  const thead = node('thead'); thead.append(head); table.append(thead)
  for (let row = start.row; row <= end.row; row++) {
    const tr = node('tr'), th = node('th', String(row)); th.scope = 'row'; tr.append(th)
    for (let col = start.col; col <= end.col; col++) {
      const address = `${column(col)}${row}`, cell = cells.get(address), td = node('td'), button = node('button', cell?.display || '　')
      button.type = 'button'; button.setAttribute('aria-label', `${address}：${cell?.display || '空白'}`)
      button.addEventListener('click', () => {
        info.textContent = `${address}\n原始值：${JSON.stringify(cell?.raw ?? null)}\n显示值：${cell?.display ?? ''}\n公式：${cell?.formula ?? '无'}\n缓存结果：${JSON.stringify(cell?.cached ?? null)}\n批注：${(cell?.comments ?? []).map((c) => c.text).join('\n')}\n合并区域：${result.merges.join('、') || '无'}`
      })
      td.append(button); tr.append(td)
    }
    body.append(tr)
  }
  table.append(body); return table
}
