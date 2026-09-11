export const REFRIGERANT_CATEGORIES = { refrigerant: '制冷剂', water: '载冷剂·水', eg: '载冷剂·乙二醇(EG)', pg: '载冷剂·丙二醇(PG)' }
export const CONCENTRATION_BASES = { volume: '体积浓度（Vol.）', mass: '质量浓度（Wt.）' }
export const REFRIGERANT_FIELDS = {
  sequence: { column: 'A', label: '序号', unit: null, headerCell: 'A2' },
  category: { column: 'B', label: '类别', unit: null, headerCell: 'B2' },
  name: { column: 'C', label: '介质标识', unit: null, headerCell: 'C2' },
  description: { column: 'D', label: '介质说明', unit: null, headerCell: 'D2' },
  concentrationPercent: { column: 'E', label: '浓度值(%)', unit: '%', headerCell: 'E2', hidden: true },
}
function evidence(sheet, address) {
  const { address: ignored, ...cell } = sheet.cells[address] ?? {}
  return { cell: address, raw: null, display: '', formula: null, cached: null, type: 'z', format: null, comments: [], hyperlink: null, ...cell }
}
export function compileRefrigerants({ index, source }) {
  const sheet = index.sheets[0]
  if (index.format !== 'xlsx' || index.sheets.length !== 1 || sheet.name !== '冷媒清单' || !sheet.complete ||
      sheet.range !== 'A1:E63' || sheet.indexedRange !== sheet.range || JSON.stringify(sheet.merges) !== '["A1:E1"]') throw new Error('冷媒清单布局变化或索引不完整，请核对后再导入')
  const fields = Object.entries(REFRIGERANT_FIELDS)
  for (const [, field] of fields) if (sheet.cells[field.headerCell]?.raw !== field.label) throw new Error(`冷媒表头变化：${field.headerCell}`)
  if (sheet.cells.A1?.raw !== '冷媒 / 载冷剂清单梳理（共 61 项）' || fields.slice(1).some(([, f]) => sheet.cells[f.column + '1']?.raw != null)) throw new Error('冷媒标题变化')
  const byName = Object.create(null), bySequence = Object.create(null)
  for (let row = 3; row <= 63; row++) {
    const cells = Object.fromEntries(fields.map(([key, f]) => [key, evidence(sheet, f.column + row)]))
    const item = Object.fromEntries(Object.entries(cells).map(([key, cell]) => [key, cell.raw]))
    if (Object.values(cells).some(c => c.type === 'e' || c.formula)) throw new Error(`冷媒第${row}行出现错误值或新公式，需核对`)
    if (item.sequence !== row - 2 || typeof item.name !== 'string' || !/^[A-Za-z0-9.]+$/.test(item.name) || !item.description) throw new Error(`冷媒第${row}行缺少或改变编号/标识`)
    const categoryKey = Object.keys(REFRIGERANT_CATEGORIES).find(k => REFRIGERANT_CATEGORIES[k] === item.category)
    if (!categoryKey || Object.hasOwn(byName, item.name)) throw new Error(`冷媒类别未知或标识重复：${item.name}`)
    const match = /^(EG|PG)(\d+)(Vol|Wt)\.$/.exec(item.name)
    if (match && (categoryKey !== match[1].toLowerCase() || item.concentrationPercent !== Number(match[2]))) throw new Error(`冷媒浓度与标识矛盾：${item.name}`)
    if (!match && item.concentrationPercent !== null) throw new Error(`冷媒浓度基准不明：${item.name}`)
    if (item.concentrationPercent !== null && (!Number.isFinite(item.concentrationPercent) || item.concentrationPercent < 0 || item.concentrationPercent > 100)) throw new Error(`冷媒浓度超出范围：${item.name}`)
    const concentrationBasis = match ? match[3] === 'Vol' ? 'volume' : 'mass' : null
    byName[item.name] = { ...item, categoryKey, concentrationBasis, concentrationBasisSource: match ? cells.name.cell : null,
      sourceRange: `A${row}:E${row}`, evidence: cells, review: [
        ...(match ? [{ code: 'basis_from_identifier', cell: cells.name.cell, message: '浓度基准按介质标识中的Vol./Wt.区分，不互换或换算；隐藏E列保留原浓度百分数' }] :
          [{ code: 'concentration_not_provided', cell: cells.concentrationPercent.cell, message: '原表未提供浓度，不补成0%或100%' }]),
        { code: 'property_mapping_unverified', message: '目录未提供物性、适用工况或DLL映射；原表序号不是已验证的DLL编码' }],
      propertyMappingReady: false, calculationReady: false }
    bySequence[item.sequence] = item.name
  }
  return { schemaVersion: 1, catalogId: 'refrigerants', count: Object.keys(byName).length, fields: REFRIGERANT_FIELDS,
    categories: REFRIGERANT_CATEGORIES, concentrationBases: CONCENTRATION_BASES,
    categoryCounts: Object.fromEntries(Object.keys(REFRIGERANT_CATEGORIES).map(key => [key, Object.values(byName).filter(r => r.categoryKey === key).length])),
    source: { ...source, sheet: sheet.name, indexedRange: sheet.indexedRange, hidden: sheet.hidden, merges: sheet.merges, columns: sheet.columns,
      headers: Object.fromEntries([1, 2].flatMap(row => fields.map(([, f]) => [f.column + row, evidence(sheet, f.column + row)]))), issues: index.issues }, bySequence, byName }
}
export const refrigerantsJson = catalog => JSON.stringify(catalog, null, 2) + '\n'
export function refrigerantsCsv(catalog) {
  const quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`
  const rows = [[...Object.values(catalog.fields).map(f => f.label), '浓度基准', '来源', '待核对'], ...Object.values(catalog.byName).map(r => [
    ...Object.keys(catalog.fields).map(k => r.evidence[k].display), CONCENTRATION_BASES[r.concentrationBasis] ?? '未提供', `${catalog.source.sheet}!${r.sourceRange}`, r.review.map(x => x.message).join('；')])]
  return '\uFEFF' + rows.map(row => row.map(quote).join(',')).join('\r\n') + '\r\n'
}
