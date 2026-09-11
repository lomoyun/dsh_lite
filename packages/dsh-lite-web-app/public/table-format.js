import { tableFromGrid, TABLE_LIMITS, normalizeTables } from './table-data.js'

export function parseDelimited(text, delimiter) {
  const source = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const rows = [], row = []
  let value = '', quoted = false, closed = false
  const field = () => { row.push(value); value = ''; closed = false }
  const line = () => {
    field(); rows.push(row.splice(0))
    if (rows.length > TABLE_LIMITS.rows + 1) throw new Error(`表格超过 ${TABLE_LIMITS.rows} 行数据，请拆分后导入`)
  }
  const unquoted = (char) => {
    if (char === delimiter) field()
    else if (char === '\n') line()
    else if (char === '"' && value === '' && !closed) quoted = true
    else if (closed) throw new Error('引号结束后应为分隔符或换行，请检查 CSV 格式')
    else value += char
    if (row.length > TABLE_LIMITS.columns) throw new Error(`表格最多 ${TABLE_LIMITS.columns} 列`)
  }
  for (let index = 0; index < source.length; index++) {
    const char = source[index]
    if (quoted) {
      if (char !== '"') value += char
      else if (source[index + 1] === '"') { value += '"'; index++ }
      else { quoted = false; closed = true }
      continue
    }
    unquoted(char)
  }
  if (quoted) throw new Error('存在未闭合的引号，请检查 CSV 格式')
  const hasTrailingRow = () => value !== '' || closed || row.length || (source && !source.endsWith('\n'))
  if (hasTrailingRow()) line()
  return rows
}

export function markdownCells(line) {
  let text = line.trim()
  if (text.startsWith('|')) text = text.slice(1)
  if (text.endsWith('|') && !text.endsWith('\\|')) text = text.slice(0, -1)
  const cells = []
  let value = ''
  for (let index = 0; index < text.length; index++) {
    if (text[index] === '\\' && ['|', '\\'].includes(text[index + 1])) value += text[++index]
    else if (text[index] === '|') { cells.push(value.trim()); value = '' }
    else value += text[index]
  }
  cells.push(value.trim())
  return cells
}

export function markdownTableAt(lines, index) {
  if (!lines[index]?.includes('|') || !lines[index + 1]?.includes('|')) return null
  const columns = markdownCells(lines[index])
  const separators = markdownCells(lines[index + 1])
  if (columns.length !== separators.length || !separators.every((cell) => /^:?-{3,}:?$/.test(cell))) return null
  const grid = [columns]
  let end = index + 2
  while (end < lines.length && lines[end].trim() && lines[end].includes('|')) grid.push(markdownCells(lines[end++]))
  return { table: tableFromGrid(grid), end }
}

export function delimiterOf(text) {
  const counts = { ',': 0, ';': 0, '\t': 0 }
  let quoted = false
  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (char === '"') { quoted = !quoted; continue }
    if (quoted) continue
    if (char === '\n' || char === '\r') break
    if (Object.hasOwn(counts, char)) counts[char]++
  }
  return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0]
}

export function parsePastedTables(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const tables = []
  for (let index = 0; index < lines.length; index++) {
    const match = markdownTableAt(lines, index)
    if (match) { tables.push(match.table); index = match.end - 1 }
  }
  if (tables.length) return normalizeTables(tables)
  const delimiter = delimiterOf(text)
  if (!text.includes(delimiter) || !text.includes('\n')) return []
  const grid = parseDelimited(text, delimiter)
  if (grid.length < 2 || grid[0].length < 2) return []
  return [tableFromGrid(grid, { title: '粘贴表格', source: '粘贴内容' })]
}
