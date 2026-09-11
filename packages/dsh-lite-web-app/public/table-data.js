export const TABLE_LIMITS = Object.freeze({ tables: 8, rows: 200, columns: 30,
  cells: 6000, text: 40000, cellText: 2000, fileBytes: 5 * 1024 * 1024 })

function cellText(value) {
  if (value == null) return ''
  if (!['string', 'number', 'boolean'].includes(typeof value) ||
    (typeof value === 'number' && !Number.isFinite(value))) throw new Error('单元格必须是文本或有限数值')
  const text = String(value)
  if (text.length > TABLE_LIMITS.cellText) throw new Error(`单元格最多 ${TABLE_LIMITS.cellText} 字符`)
  return text
}

function label(value, fallback, max) {
  if (value == null) return fallback
  if (typeof value !== 'string' || value.length > max) throw new Error('表格名称或来源过长或格式无效')
  return value
}

function normalizeTable(input) {
  if (!input || !Array.isArray(input.columns) || !Array.isArray(input.rows)) throw new Error('表格格式无效')
  if (!input.columns.length || input.columns.length > TABLE_LIMITS.columns) {
    throw new Error(`每张表需要 1–${TABLE_LIMITS.columns} 列`)
  }
  if (input.rows.length > TABLE_LIMITS.rows) throw new Error(`每张表最多 ${TABLE_LIMITS.rows} 行数据，请拆分后导入`)
  const columns = input.columns.map(cellText)
  const rows = input.rows.map((row) => {
    if (!Array.isArray(row) || row.length > columns.length) throw new Error('数据行列数超过表头，请检查表格')
    return Array.from({ length: columns.length }, (_, index) => cellText(row[index]))
  })
  const warnings = input.warnings ?? []
  if (!Array.isArray(warnings) || warnings.length > 8) throw new Error('表格提示格式无效')
  return { title: label(input.title, '提取表格', 120), source: label(input.source, '', 240),
    columns, rows, warnings: warnings.map((value) => label(value, '', 240)) }
}

export function normalizeTables(input) {
  if (!Array.isArray(input) || input.length > TABLE_LIMITS.tables) throw new Error(`每次最多 ${TABLE_LIMITS.tables} 张表格`)
  const tables = input.map(normalizeTable)
  const cells = tables.flatMap((table) => [table.columns, ...table.rows]).flat()
  if (cells.length > TABLE_LIMITS.cells) throw new Error(`每次最多 ${TABLE_LIMITS.cells} 个单元格，请拆分后导入`)
  if (cells.reduce((sum, text) => sum + text.length, 0) > TABLE_LIMITS.text) throw new Error('表格文本过多，请拆分后导入')
  return tables
}

export function tableFromGrid(grid, meta = {}) {
  if (!Array.isArray(grid) || !grid.length) throw new Error('表格为空')
  const width = Math.max(...grid.map((row) => row.length))
  if (!width || width > TABLE_LIMITS.columns) throw new Error(`每张表需要 1–${TABLE_LIMITS.columns} 列`)
  const padded = grid.map((row) => Array.from({ length: width }, (_, i) => cellText(row[i])))
  return normalizeTables([{ ...meta, columns: padded[0], rows: padded.slice(1) }])[0]
}

export function tableToTsv(table) {
  const [clean] = normalizeTables([table])
  const escape = (value) => /[\t\n\r"]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
  return [clean.columns, ...clean.rows].map((row) => row.map(escape).join('\t')).join('\n')
}
