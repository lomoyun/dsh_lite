const layout = [
  ['name', '模具号', 'A', null, 'identity'],
  ['widthMm', '管宽', 'B', 'mm', 'geometry'],
  ['heightMm', '管高', 'C', 'mm', 'geometry'],
  ['portCount', '孔数', 'D', null, 'geometry'],
  ['neckWidthMm', '缩口宽度', 'E', 'mm', 'geometry'],
  ['neckLengthMm', '缩口长度', 'F', 'mm', 'geometry'],
  ['portWidthMm', '孔宽', 'G', 'mm', 'geometry'],
  ['portHeightMm', '孔高', 'H', 'mm', 'geometry'],
  ['noseMm', 'Nose', 'I', 'mm', 'geometry'],
  ['wallThicknessMm', '壁厚', 'J', 'mm', 'geometry'],
  ['ribThicknessMm', '筋厚', 'K', 'mm', 'geometry'],
  ['materialAreaMm2', '材料截面积', 'L', 'mm2', 'geometry'],
  ['flowAreaMm2', '流通截面积', 'M', 'mm2', 'geometry'],
  ['designPressureMpa', '设计压力', 'N', 'MPa', 'selection'],
  ['beforeBrazingPressureMpa', '焊前压力', 'O', 'MPa', 'selection'],
  ['application', '应用范围', 'P', null, 'selection'],
]
export const FLAT_TUBE_FIELDS = Object.fromEntries(layout.map(([key, label, column, unit, group]) => [key, { label, column, unit, group }]))
const numericPattern = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/
const number = value => typeof value === 'number' && Number.isFinite(value)

export function numericValue(raw) {
  if (number(raw)) return raw
  if (typeof raw !== 'string' || !numericPattern.test(raw.trim())) return null
  const value = Number(raw.trim())
  return Number.isFinite(value) ? value : null
}
function sourceCell(sheet, address) {
  const cell = sheet.cells[address]
  return { cell: address, raw: cell?.raw ?? null, display: cell?.display ?? '',
    formula: cell?.formula ?? null, cached: cell?.cached ?? null, type: cell?.type ?? 'z' }
}
function checkedSheet(index) {
  const sheet = index.sheets.find(item => item.name === '总表')
  if (!sheet?.complete || sheet.range !== sheet.indexedRange) throw new Error('总表未完整索引，不能生成完整扁管目录')
  if (!/^A1:P\d+$/.test(sheet.range)) throw new Error('总表出现预期16列之外的内容，请核对新增字段')
  if (index.sheets.some(item => !['总表', 'Macro1'].includes(item.name))) throw new Error('出现未分类 Sheet，请先核对其型号范围')
  for (const field of Object.values(FLAT_TUBE_FIELDS)) {
    if (sheet.cells[field.column + '1']?.raw !== field.label) throw new Error(`表头不匹配：${field.column}1 应为 ${field.label}`)
    if ((sheet.cells[field.column + '2']?.raw ?? null) !== field.unit) throw new Error(`单位不匹配：${field.column}2`)
  }
  return sheet
}
function reviewGeometry(geometry, evidence) {
  const review = []
  for (const [field, value] of Object.entries(geometry)) {
    const cell = evidence[field]
    if (value === null) review.push({ code: 'non_scalar_geometry', field, cell: cell.cell,
      message: `${FLAT_TUBE_FIELDS[field].label} 原文为 ${cell.raw === null ? '空白' : JSON.stringify(cell.raw)}，不能作为单一数值使用` })
    else if (value <= 0 || (field === 'portCount' && !Number.isInteger(value))) {
      review.push({ code: 'invalid_geometry_number', field, cell: cell.cell, message: '尺寸须为正数，孔数须为正整数；原值未修改' })
    }
  }
  if (number(geometry.portHeightMm) && number(geometry.heightMm) && geometry.portHeightMm > geometry.heightMm) {
    review.push({ code: 'port_exceeds_height', field: 'portHeightMm', cell: evidence.portHeightMm.cell,
      message: '原表孔高大于管高，需核对；未自动修改' })
  }
  if (number(geometry.wallThicknessMm) && number(geometry.heightMm) && geometry.wallThicknessMm >= geometry.heightMm) {
    review.push({ code: 'wall_exceeds_height', field: 'wallThicknessMm', cell: evidence.wallThicknessMm.cell,
      message: '原表壁厚不小于管高，需核对；未自动修改' })
  }
  return review
}
function rowOf(sheet, row) {
  const evidence = Object.fromEntries(Object.entries(FLAT_TUBE_FIELDS).map(([key, field]) => [key, sourceCell(sheet, field.column + row)]))
  if (Object.values(evidence).every(cell => cell.raw === null)) return null
  const name = evidence.name.raw
  if (typeof name !== 'string' || !name.trim()) throw new Error(`第 ${row} 行缺少模具号，不能静默遗漏`)
  const geometry = {}, selection = {}
  for (const [key, field] of Object.entries(FLAT_TUBE_FIELDS)) {
    const cell = evidence[key]
    if (field.group === 'geometry') geometry[key] = cell.type === 'e' ? null : numericValue(cell.raw)
    if (field.group === 'selection') selection[key] = cell.raw
  }
  return { name, sourceRange: `A${row}:P${row}`, geometry, selection, evidence,
    review: reviewGeometry(geometry, evidence), availability: 'not_verified', calculationReady: false }
}
export function compileFlatTubes({ index, source }) {
  const sheet = checkedSheet(index), byName = Object.create(null)
  const endRow = Number(/\d+$/.exec(sheet.range)[0])
  for (let row = 3; row <= endRow; row++) {
    const tube = rowOf(sheet, row)
    if (!tube) continue
    if (Object.hasOwn(byName, tube.name)) throw new Error(`重复模具号 ${tube.name}，停止导入以避免覆盖`)
    byName[tube.name] = tube
  }
  const tubes = Object.values(byName)
  if (!tubes.length) throw new Error('总表没有扁管型号')
  return { schemaVersion: 1, catalogId: 'flat-tubes', count: tubes.length,
    source: { ...source, sheet: sheet.name, indexedRange: sheet.indexedRange, dataRange: `A3:P${endRow}`,
      excludedSheets: index.sheets.filter(item => item.name !== sheet.name).map(item => ({ name: item.name, hidden: item.hidden, reason: '宏 Sheet，不是扁管型号；未执行' })) },
    fields: FLAT_TUBE_FIELDS,
    policy: { names: 'exact_source_name', formulas: 'original_cached_values_without_recalculation',
      geometry: 'only_plain_numbers_or_numeric_text_are_normalized', selection: 'candidate_catalog_not_calculation_input',
      availability: '未将颜色或图形说明映射为供货承诺；所有型号均保留' },
    reviewCount: tubes.filter(tube => tube.review.length).length, byName }
}
export function getFlatTube(catalog, name) {
  if (typeof name !== 'string' || !Object.hasOwn(catalog.byName, name)) throw new Error(`扁管型号不存在：${String(name)}`)
  return { catalogId: catalog.catalogId, source: catalog.source, fields: catalog.fields, tube: catalog.byName[name] }
}
function checkedFilter(input) {
  const allowed = new Set(['widthMm', 'heightMm', 'portCount', 'nameContains', 'offset', 'limit'])
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('筛选条件必须是对象')
  for (const [key, value] of Object.entries(input)) {
    if (!allowed.has(key)) throw new Error(`未知筛选字段：${key}`)
    if (key === 'nameContains') { if (typeof value !== 'string') throw new Error('名称筛选必须为文本'); continue }
    if (!number(value) || value < 0 || (key !== 'offset' && value === 0)) throw new Error(`筛选值无效：${key}`)
    if (['portCount', 'offset', 'limit'].includes(key) && !Number.isInteger(value)) throw new Error(`筛选值须为整数：${key}`)
  }
  const offset = input.offset ?? 0, limit = input.limit ?? 20
  if (limit > 100) throw new Error('每页最多 100 项')
  return { ...input, offset, limit }
}
export function listFlatTubes(catalog, input = {}) {
  const filter = checkedFilter(input)
  const matches = Object.values(catalog.byName).filter(tube => {
    if (filter.nameContains !== undefined && !tube.name.includes(filter.nameContains)) return false
    return ['widthMm', 'heightMm', 'portCount'].every(key => filter[key] === undefined || tube.geometry[key] === filter[key])
  })
  const page = matches.slice(filter.offset, filter.offset + filter.limit)
  return { catalogId: catalog.catalogId, source: catalog.source, total: matches.length,
    nextOffset: filter.offset + page.length < matches.length ? filter.offset + page.length : null,
    items: page.map(tube => ({ name: tube.name, geometry: tube.geometry, selection: tube.selection,
      sourceRange: tube.sourceRange, review: tube.review, availability: tube.availability, calculationReady: tube.calculationReady })) }
}

export function flatTubesCsv(catalog) {
  const keys = Object.keys(FLAT_TUBE_FIELDS), quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`
  const header = [...keys.map(key => {
    const field = FLAT_TUBE_FIELDS[key]
    return field.label + (field.unit ? ` (${field.unit})` : '')
  }), '来源区域', '待核对项']
  const rows = Object.values(catalog.byName).map(tube => [
    ...keys.map(key => tube.evidence[key].display), `${catalog.source.sheet}!${tube.sourceRange}`, tube.review.map(item => item.message).join('；'),
  ])
  return '\uFEFF' + [header, ...rows].map(row => row.map(quote).join(',')).join('\r\n') + '\r\n'
}

export function flatTubesJson(catalog) {
  const { byName, ...header } = catalog
  const rows = Object.entries(byName).map(([name, tube]) => `    ${JSON.stringify(name)}: ${JSON.stringify(tube)}`)
  // 每个型号一行；按名称查阅和比较变更时无需展开整本目录。
  return JSON.stringify(header, null, 2).slice(0, -2) + ',\n  "byName": {\n' + rows.join(',\n') + '\n  }\n}\n'
}
