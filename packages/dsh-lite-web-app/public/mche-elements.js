export function element(tag, text = '', className = '') {
  const item = document.createElement(tag); item.className = className
  if (text !== '') item.textContent = String(text)
  return item
}
export function button(text, action) {
  const item = element('button', text); item.type = 'button'; item.addEventListener('click', action); return item
}
export function disclosure(title, content, key, open = false) {
  const node = element('details'); node.open = open
  if (key) node.dataset.disclosure = key
  node.append(element('summary', title), content); return node
}
export function primaryAction(node) { node.dataset.primaryAction = 'true'; return node }
export function revealField(node) {
  for (let parent = node.parentElement; parent; parent = parent.parentElement) if (parent.tagName === 'DETAILS') parent.open = true
  node.setAttribute('aria-invalid', 'true'); node.focus(); node.scrollIntoView({ block: 'center' })
  node.addEventListener('input', () => node.removeAttribute('aria-invalid'), { once: true })
}
export function message(text) { return element('p', text, 'mche-note') }
export function numberText(value) {
  return typeof value === 'number' ? new Intl.NumberFormat('zh-CN', { maximumSignificantDigits: 12, useGrouping: false }).format(value) : value ?? '未知'
}
export function table(headers, rows) {
  const wrap = element('div', '', 'mche-table-wrap'), grid = element('table', '', 'mche-table')
  wrap.tabIndex = 0; wrap.setAttribute('role', 'region'); wrap.setAttribute('aria-label', `${headers[0]}表格，可横向滚动`)
  const head = element('thead'), tr = element('tr'), body = element('tbody')
  headers.forEach((label) => { const th = element('th', label); th.scope = 'col'; tr.append(th) })
  head.append(tr)
  for (const row of rows) {
    const line = element('tr')
    for (const cell of row) { const td = element('td'); td.append(cell instanceof Node ? cell : document.createTextNode(String(cell ?? '未知'))); line.append(td) }
    body.append(line)
  }
  grid.append(head, body); wrap.append(grid); return wrap
}
export function issues(title, values = []) {
  if (!values.length) return document.createDocumentFragment()
  if (title.startsWith('满足')) return disclosure(`${title}（${values.length}）`, issues('匹配依据', values))
  const section = element('section'); section.append(element('h4', `${title}（${values.length}）`))
  if (!values.length) section.append(message('无已记录项'))
  else { const list = element('ul'); values.forEach((item) => list.append(element('li', issueText(item)))); section.append(list) }
  return section
}
function issueText(item) {
  const comparison = item.expected !== undefined ? `（条件 ${JSON.stringify(item.expected)}，目录 ${JSON.stringify(item.actual ?? '未知')}；${item.basis === 'draft' ? '草稿依据' : '已确认条件'}）` : ''
  return `${item.message}${comparison}${item.cell ? ` · ${item.cell}` : ''}`
}
export function geometry(snapshot) {
  const { tube, fields, source } = snapshot
  const section = element('section')
  section.append(element('h3', `型号 ${tube.name}`), message(`来源：${source.fileName ?? source.file ?? '原始扁管目录'} · ${source.sheet}!${tube.sourceRange}`))
  const rows = Object.entries(tube.geometry).map(([key, value]) => [fields[key].label, value === null ? '未知（见原文）' : numberText(value), fields[key].unit ?? '个',
    tube.evidence?.[key]?.display ?? '详见精确型号', tube.evidence?.[key]?.cell ?? ''])
  section.append(table(['尺寸', '目录值', '单位', '原文', '单元格'], rows))
  section.append(issues('尺寸矛盾 / 无效数值', tube.review.filter((item) => item.code !== 'non_scalar_geometry')),
    issues('未知 / 非单值几何', tube.review.filter((item) => item.code === 'non_scalar_geometry')))
  section.append(message(`目录摘要：${snapshot.catalogDigest}。原文及问题保留；选定型号不表示问题已解决。`))
  return section
}
