import { numericValue } from './flat-tubes.mjs'
import { FIN_COLUMNS, FIN_HEADER_ROWS, FIN_EXPECTED_HEADERS, FIN_SECTIONS } from './fin-layout.mjs'
export { FIN_SECTIONS } from './fin-layout.mjs'
const finite = value => typeof value === 'number' && Number.isFinite(value)
const nonempty = value => value !== null && (typeof value !== 'string' || value.trim() !== '')
function sourceCell(sheet, address) {
  const cell = sheet.cells[address]
  return { cell: address, raw: cell?.raw ?? null, display: cell?.display ?? '', formula: cell?.formula ?? null,
    cached: cell?.cached ?? null, type: cell?.type ?? 'z', format: cell?.format ?? null,
    comments: cell?.comments ?? [], hyperlink: cell?.hyperlink ?? null }
}
function checkedSheet(index) {
  if (index.sheets.length !== 1 || index.sheets[0].name !== 'Fin') throw new Error('出现未分类 Sheet，请先核对翅片分区')
  const sheet = index.sheets[0]
  if (!sheet.complete || sheet.range !== sheet.indexedRange) throw new Error('Fin 未完整索引，不能生成完整目录')
  if (sheet.range !== 'A1:AA174') throw new Error('Fin 行列范围变化，请先核对型号和分区')
  if (JSON.stringify(sheet.merges) !== JSON.stringify(['C1:Q1', 'R1:U1', 'V1:Y1'])) throw new Error('Fin 合并区域变化，请核对布局')
  for (const row of FIN_HEADER_ROWS) for (const column of FIN_COLUMNS) {
    if ((sheet.cells[column + row]?.raw ?? null) !== (FIN_EXPECTED_HEADERS[row][column] ?? null)) {
      throw new Error(`表头、单位或分区不匹配：${column}${row}`)
    }
  }
  return sheet
}
function reviewFin(fin, fields) {
  const review = []
  const add = (code, field, message) => review.push({ code, field, cell: fin.evidence[field].cell, message })
  for (const [key, value] of Object.entries(fin.geometry)) {
    const raw = fin.evidence[key].raw
    if (value === null) add('non_scalar_geometry', key, `${fields[key].label} 原文为 ${raw === null ? '空白' : JSON.stringify(raw)}，不能作为单一数值使用`)
    else if (value < 0 || (value === 0 && !['brazingChangeMm', 'louverAngleDeg', 'louverCount'].includes(key)) || (key === 'louverCount' && !Number.isInteger(value))) {
      add('invalid_geometry_number', key, '尺寸数值或开窗个数需核对；原值未修改')
    }
  }
  for (const key of Object.keys(fin.unclassified)) if (nonempty(fin.unclassified[key])) {
    add('unlabeled_source_column', key, '本分区该列没有表头，保留原值，未猜测字段含义')
  }
  if (fin.code === null) add('missing_or_noncode', 'code', 'Code/ERP 空白或为说明文字；未补造编号，原文保留')
  const g = fin.geometry
  if ([g.heightPreBrazingMm, g.heightPostBrazingMm, g.brazingChangeMm].every(finite) &&
      Math.abs(g.heightPreBrazingMm - g.heightPostBrazingMm - g.brazingChangeMm) > 1e-9) {
    add('brazing_change_mismatch', 'brazingChangeMm', '焊前高度减焊后高度不等于原表钎焊变化量；三个原值均保留')
  }
  if (finite(g.rMm) && finite(g.widthMm) && finite(g.heightPreBrazingMm) && g.rMm > Math.max(g.widthMm, g.heightPreBrazingMm)) {
    add('r_exceeds_dimensions', 'rMm', '原表 R 大于翅片宽度和焊前高度，需回查图纸；未改成猜测的小数')
  }
  const range = fin.evidence.finPitchRangeMm?.raw
  if (finite(numericValue(range))) add('single_number_pitch_range', 'finPitchRangeMm', '片距范围列为单一数字，范围含义及单位需核对')
  const match = typeof range === 'string' && /^(\d+(?:\.\d+)?)\s*[-~]\s*(\d+(?:\.\d+)?)$/.exec(range.trim())
  if (match && finite(g.finPitchMm) && (g.finPitchMm < Number(match[1]) || g.finPitchMm > Number(match[2]))) {
    add('pitch_outside_sample_range', 'finPitchRangeMm', '片距不在原表样品片距范围内；未替换片距或范围')
  }
  for (const [key, cell] of Object.entries(fin.evidence)) if (/报废|暂不可用|Not Available|内部无法自制|无图纸/.test(String(cell.raw ?? ''))) {
    add('source_restriction', key, '原表存在使用、制造或图纸限制，请保留原文并核对当前状态')
  }
  if (fin.section === 'dongsheng') {
    review.push({ code: 'section_restriction', cell: 'A162', message: FIN_SECTIONS.dongsheng.label })
    review.push({ code: 'section_header_inherited', cell: 'A162', message: '本分区未重列尺寸表头，按主表对应列保存，正式映射前需确认' })
  }
  return review
}
function rowOf(sheet, row, section) {
  const fields = FIN_SECTIONS[section].fields
  const evidence = Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, sourceCell(sheet, field.column + row)]))
  const name = evidence.name.raw
  if (typeof name !== 'string' || !/^B[0-9A-Za-z]+$/.test(name)) throw new Error(`第 ${row} 行缺少或出现未知型号，不能静默遗漏`)
  const rawCode = evidence.code.raw
  const code = evidence.code.type === 'e' || !nonempty(rawCode) || rawCode === '无图纸' ? null : String(rawCode)
  const geometry = {}, selection = {}, unclassified = {}
  for (const [key, field] of Object.entries(fields)) {
    const cell = evidence[key]
    if (field.group === 'geometry') geometry[key] = cell.type === 'e' || key === 'finPitchRangeMm' ? null : numericValue(cell.raw)
    if (field.group === 'selection') selection[key] = cell.raw
    if (field.group === 'unclassified') unclassified[key] = cell.raw
  }
  const fin = { name, code, section, sourceRange: `A${row}:AA${row}`, geometry, selection, unclassified, evidence,
    availability: 'not_verified', calculationReady: false }
  fin.review = reviewFin(fin, fields)
  return fin
}
export function compileFins({ index, source }) {
  const sheet = checkedSheet(index), byName = Object.create(null), byCode = Object.create(null)
  for (const [section, definition] of Object.entries(FIN_SECTIONS)) {
    for (let row = definition.firstRow; row <= definition.lastRow; row++) {
      const fin = rowOf(sheet, row, section)
      if (Object.hasOwn(byName, fin.name)) throw new Error(`重复型号 ${fin.name}，停止导入以避免覆盖`)
      byName[fin.name] = fin
      if (fin.code !== null) (byCode[fin.code] ??= []).push(fin.name)
    }
  }
  for (const [code, names] of Object.entries(byCode)) if (names.length > 1) for (const name of names) {
    byName[name].review.push({ code: 'shared_code', field: 'code', cell: byName[name].evidence.code.cell,
      message: `Code/ERP ${code} 对应多个型号：${names.join('、')}；未合并或覆盖` })
  }
  const fins = Object.values(byName)
  return { schemaVersion: 1, catalogId: 'fins', count: fins.length,
    source: { ...source, sheet: sheet.name, indexedRange: sheet.indexedRange, hidden: sheet.hidden,
      dataRanges: Object.values(FIN_SECTIONS).map(s => `A${s.firstRow}:AA${s.lastRow}`),
      headers: Object.fromEntries(FIN_HEADER_ROWS.map(row => [row, Object.fromEntries(FIN_COLUMNS.map(c => [c, sourceCell(sheet, c + row)]))])),
      merges: sheet.merges, issues: index.issues },
    sections: FIN_SECTIONS,
    policy: { names: 'exact_source_name', codes: 'exact_source_code_text_one_to_many_no_range_expansion',
      formulas: 'original_cached_values_without_recalculation',
      geometry: 'only_plain_numbers_or_numeric_text_are_normalized_except_pitch_ranges',
      sectionHeaders: 'local_geometry_headers_override_main_unknown_columns_preserved',
      units: 'lower_sections_inherit_workbook_column_units_and_require_confirmation_before_calculation',
      selection: 'candidate_catalog_not_calculation_input', availability: '保留原表状态与备注，不将颜色或历史状态视为当前供货承诺' },
    sectionCounts: Object.fromEntries(Object.keys(FIN_SECTIONS).map(s => [s, fins.filter(f => f.section === s).length])),
    reviewCount: fins.filter(fin => fin.review.length).length,
    missingCodeCount: fins.filter(fin => fin.code === null).length,
    sharedCodeCount: Object.values(byCode).filter(names => names.length > 1).length, byCode, byName }
}
export function getFin(catalog, name) {
  if (typeof name !== 'string' || !Object.hasOwn(catalog.byName, name)) throw new Error(`翅片型号不存在：${String(name)}`)
  const fin = catalog.byName[name]
  return { catalogId: catalog.catalogId, source: querySource(catalog), section: catalog.sections[fin.section], fin }
}
function querySource(catalog) {
  const { headers, ...source } = catalog.source
  return source
}
const geometryFilters = new Set(Object.values(FIN_SECTIONS).flatMap(s => Object.entries(s.fields)
  .filter(([key, field]) => field.group === 'geometry' && key !== 'finPitchRangeMm').map(([key]) => key)))
function checkedFilter(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('筛选条件必须是对象')
  for (const [key, value] of Object.entries(input)) {
    if (['nameContains', 'code', 'section'].includes(key)) {
      if (typeof value !== 'string' || (key !== 'nameContains' && !value)) throw new Error(`筛选值必须为文本：${key}`)
      if (key === 'section' && !Object.hasOwn(FIN_SECTIONS, value)) throw new Error('未知翅片分区')
    } else {
      if (!geometryFilters.has(key) && !['offset', 'limit'].includes(key)) throw new Error(`未知筛选字段：${key}`)
      if (!finite(value) || value < 0 || (value === 0 && !['offset', 'louverCount', 'louverAngleDeg', 'brazingChangeMm'].includes(key))) throw new Error(`筛选值无效：${key}`)
      if (['offset', 'limit', 'louverCount'].includes(key) && !Number.isInteger(value)) throw new Error(`筛选值须为整数：${key}`)
    }
  }
  if ((input.limit ?? 20) > 100) throw new Error('每页最多 100 项')
  return { ...input, offset: input.offset ?? 0, limit: input.limit ?? 20 }
}
export function listFins(catalog, input = {}) {
  const filter = checkedFilter(input)
  const matches = Object.values(catalog.byName).filter(fin => {
    if (filter.nameContains !== undefined && !fin.name.includes(filter.nameContains)) return false
    if (filter.code !== undefined && fin.code !== filter.code) return false
    if (filter.section !== undefined && fin.section !== filter.section) return false
    return [...geometryFilters].every(key => filter[key] === undefined || fin.geometry[key] === filter[key])
  })
  const items = matches.slice(filter.offset, filter.offset + filter.limit).map(({ evidence, ...fin }) => ({ ...fin,
    geometryText: Object.fromEntries(Object.keys(fin.geometry).map(key => [key, evidence[key].display])) }))
  return { catalogId: catalog.catalogId, source: querySource(catalog), total: matches.length,
    nextOffset: filter.offset + items.length < matches.length ? filter.offset + items.length : null, items }
}
export function finsJson(catalog) {
  const { byName, ...header } = catalog
  const rows = Object.entries(byName).map(([name, fin]) => `    ${JSON.stringify(name)}: ${JSON.stringify(fin)}`)
  return JSON.stringify(header, null, 2).slice(0, -2) + ',\n  "byName": {\n' + rows.join(',\n') + '\n  }\n}\n'
}
export function finsCsv(catalog) {
  const definitions = new Map()
  for (const section of Object.values(catalog.sections)) for (const [key, field] of Object.entries(section.fields)) {
    if (!definitions.has(key)) definitions.set(key, field)
  }
  const keys = [...definitions.keys()]
  const header = ['分区', ...keys.map(key => {
    const f = definitions.get(key)
    return `${key} / ${f.label ?? '未标注表头'}${f.unit ? ` (${f.unit})` : ''}`
  }), '来源区域', '待核对项']
  const rows = Object.values(catalog.byName).map(fin => [catalog.sections[fin.section].label,
    ...keys.map(key => fin.evidence[key]?.display ?? ''), `${catalog.source.sheet}!${fin.sourceRange}`,
    fin.review.map(item => `${item.cell}: ${item.message}`).join('；')])
  const quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`
  return '\uFEFF' + [header, ...rows].map(row => row.map(quote).join(',')).join('\r\n') + '\r\n'
}
