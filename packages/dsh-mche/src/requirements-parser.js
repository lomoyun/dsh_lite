import { McheError } from './validation.js'
import { canonicalUnit, equivalentUnit, hasValue, normalizeRequirement, REQUIREMENT_FIELDS } from './requirements-fields.js'
import { CONDENSER_MAPPING } from './requirements-mapping.js'

const labels = [
  ...Object.entries(CONDENSER_MAPPING.fields).map(([key, spec]) => [key, new RegExp(spec.pattern)]),
  ['customer', /^customer\s*&\s*project name/], ['heatLoad', /^expected heat rejection capacity/],
  ['refPressureDrop', /^refrigerant side pressure drop limit/], ['airAngle', /^air flow direction/],
  ['airPressureDrop', /^air side pressure drop limit/], ['fanCurve', /^fan curve/],
  ['spaceLength', /^length \(l\)/], ['spaceHeight', /^header height/], ['spaceDepth', /^depth or header diameter/],
  ['lengthIncludesHeaders', /^does length include headers/], ['lengthIncludesConnections', /^does length include connections/],
  ['areaPreference', /^you prefer same or smaller/], ['sameAreaGoal', /^if same area/], ['smallerAreaGoal', /^if smaller area/],
  ['existingCoil', /^you use mche or/], ['existingTubeWidth', /^if mche, what is tube width/], ['existingTubeFin', /^if tube&fin/],
  ['inletPipeSize', /^inlet pipe size/], ['outletPipeSize', /^outlet pipe size/], ['connectionSide', /^should tubes on same side/],
  ['finPitchLimit', /^fin pitch limits/], ['coilShape', /^finished coil shape/], ['bendingRadius', /^bending rinner/],
  ['bracket', /^assembly bracket/], ['installation', /^coil fixation/], ['background', /^could you introduce your project background/],
  ['application', /^general introduction of the unit/], ['environment', /^what kinds of evironment/],
  ['environmentalProtection', /^which is requried for enviromental protection/], ['dust', /^do you have any dust/],
  ['appearance', /^do you have any coil appearance/], ['certification', /^any ped,ul or other certification/],
  ['fatigue', /^do you have any fatigue/], ['burstPressure', /^do you have any burst/],
  ['testConditions', /^what is your test condition/], ['corrosion', /^do you have any corrosion/],
]
const clean = value => String(value ?? '').toLowerCase().replace(/[★☆]/g, '').replace(/\(\d+\)/g, '').replace(/\s+/g, ' ').trim()
function position(address) {
  const [, letters, row] = /^([A-Z]+)(\d+)$/.exec(address)
  return { row: Number(row), col: [...letters].reduce((n, c) => n*26+c.charCodeAt(0)-64, 0) }
}
function address(row, col) {
  let letters = ''
  for (; col > 0; col = Math.floor((col-1)/26)) letters = String.fromCharCode(65+(col-1)%26)+letters
  return `${letters}${row}`
}
const cellEvidence = cell => cell && ({ address: cell.address, raw: cell.raw, display: cell.display, formula: cell.formula, cached: cell.cached, format: cell.format, comments: cell.comments })
const keyOf = cell => labels.find(([, pattern]) => pattern.test(clean(cell.display)))?.[0]
const percentage = value => { const [mantissa, exponent = '0'] = String(value).split('e'); return Number(`${mantissa}e${Number(exponent)+2}`) }
// Quoted/escaped percent signs are literal suffixes, not Excel percentage scaling.
const percentageFormat = format => /%/.test(String(format ?? '').replace(/"[^\"]*"|\\.|\[[^\]]*\]/g, ''))
const isTitle = c => /customer requirement.*condenser|冷凝器.*(客户|需求)/i.test(c.display)
function identify(sheet, titleAddress) {
  let cells = Object.values(sheet.cells).filter(c => hasValue(c.raw) || hasValue(c.display))
  const allTitles = cells.filter(isTitle).sort((a, b) => position(a.address).row-position(b.address).row)
  const titles = allTitles.filter(c => !titleAddress || c.address === titleAddress)
  if (!titles.length) return null
  if (titles.length !== 1) throw new McheError('同页识别出多个需求表标题，请指定 table 标题坐标')
  const start = position(titles[0].address).row
  const end = allTitles.find(c => position(c.address).row > start)
  cells = cells.filter(c => position(c.address).row >= start && (!end || position(c.address).row < position(end.address).row))
  const anchors = cells.map(cell => ({ cell, key: keyOf(cell), ...position(cell.address) })).filter(a => a.key)
  const required = ['refrigerant', 'refTemperature', 'refPressure', 'airTemperature', 'airHumidity']
  if (!titles.length || !required.every(key => anchors.some(a => a.key === key))) return null
  // Infer the value column from repeated field + unit/unit + value structure.
  const candidates = [], unitColumns = []
  for (const anchor of anchors.filter(a => ['refTemperature', 'airTemperature', 'refPressure'].includes(a.key))) {
    const units = cells.filter(c => { const p = position(c.address); return p.row === anchor.row && p.col > anchor.col && Object.hasOwn(REQUIREMENT_FIELDS[anchor.key].units, canonicalUnit(c.display)) })
    if (units.length === 2) {
      const cols = units.map(c => position(c.address).col).sort((a, b) => a-b)
      candidates.push(cols[1]+1); unitColumns.push(cols)
    }
  }
  if (candidates.length < 2 || new Set(candidates).size !== 1 || new Set(unitColumns.map(cols => cols.join(','))).size !== 1) throw new McheError('需求字段已识别，但填写列结构不明确，请核对原表')
  const labelCol = anchors.find(a => a.key === 'refTemperature').col
  for (const cell of cells) {
    const p = position(cell.address)
    if (p.col !== labelCol || p.row <= position(titles[0].address).row || anchors.some(a => a.cell.address === cell.address)) continue
    if (/thermal requirements|available space for|project background and reliability|if you don't have|^[■□☑]$/i.test(cell.display)) continue
    if (hasValue(sheet.cells[address(p.row, candidates[0])]?.raw)) anchors.push({ cell, key: `unmapped:${cell.address}`, ...p })
  }
  anchors.sort((a, b) => a.row-b.row)
  return { title: titles[0], anchors, cells, valueCol: candidates[0], unitColumns: unitColumns[0] }
}

export function requirementTables(index, sheetName, table) {
  return index.sheets.filter(s => sheetName === undefined || s.name === sheetName).flatMap(sheet =>
    Object.values(sheet.cells).filter(c => isTitle(c) && (!table || c.address === table)).flatMap(title => {
      const found = identify(sheet, title.address)
      return found ? [{ sheet: sheet.name, table: title.address, title: title.display, hidden: sheet.hidden }] : []
    }))
}

export function extractRequirements(index, meta, sheetName, table) {
  const candidates = requirementTables(index, sheetName, table)
  if (candidates.length > 1) throw new McheError(`存在多张冷凝器需求表，请指定 sheet 和 table：${candidates.map(c => `${c.sheet}!${c.table}`).join('、')}`)
  const matches = candidates.map(c => { const sheet = index.sheets.find(s => s.name === c.sheet); return { sheet, found: identify(sheet, c.table) } })
  if (!matches.length) throw new McheError('未按表内标题与字段结构识别到冷凝器需求表')
  if (matches.length !== 1) throw new McheError('存在多张冷凝器需求表，请指定 sheet 后读取')
  const { sheet, found } = matches[0]
  if (!sheet.complete) throw new McheError('需求表索引不完整，请缩小工作簿后重新上传；未读区域不能视为空白')
  const records = [], issues = [...index.issues]
  for (const { cell: label, key, row, col } of found.anchors) {
    const mergedLabel = sheet.merges.find(range => { const [start, end] = range.split(':').map(position); return start.row === row && start.col === col && end.col >= found.valueCol })
    if (mergedLabel) continue // Full-width heading, not an input cell.
    const value = sheet.cells[address(row, found.valueCol)]
    if (!value || (!hasValue(value.raw) && !hasValue(value.display))) continue
    const spec = REQUIREMENT_FIELDS[key] ?? { label: label.display, text: true, unit: '' }
    // Keep unsupported unit columns too: dropping an imperial column would make
    // the remaining metric column look like an unambiguous unit declaration.
    const unitCells = found.unitColumns.map(c => sheet.cells[address(row, c)]).filter(c => c && hasValue(c.display))
    const unitCandidates = unitCells.map(c => ({ unit: canonicalUnit(c.display), evidence: cellEvidence(c) }))
    const choose = found.cells.filter(c => /choose units|选择单位/i.test(c.display) && position(c.address).row < row)
      .sort((a, b) => position(b.address).row-position(a.address).row)[0]
    const marks = choose ? found.unitColumns.map(c => sheet.cells[address(position(choose.address).row, c)]) : []
    const marked = marks.filter(c => c && c.display.trim() === '■' && !c.formula)
    const selectedCol = marked.length === 1 ? position(marked[0].address).col : null
    const selectedCell = selectedCol ? sheet.cells[address(row, selectedCol)] : null
    const selectedUnit = canonicalUnit(selectedCell?.display)
    const explicit = typeof value.raw === 'string' ? /^[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)(?:e[+-]?\d+)?\s*(.+)$/i.exec(value.raw.trim())?.[1] : null
    const percentFormat = typeof value.raw === 'number' && percentageFormat(value.format)
    // A dimensionless Quality row may explicitly use "--". An absent unit is different.
    const rowUnit = key === 'refQuality' && selectedCell?.display.trim() === '--' ? 'fraction' : selectedUnit
    const unit = percentFormat ? '%' : explicit ? canonicalUnit(explicit) : rowUnit
    const unitIssues = []
    if (!spec.text) {
      if (!choose || marks.length !== 2 || marks.some(c => !c || c.formula || !/^[■□]$/.test(c.display.trim()))) unitIssues.push('Choose units 选框未完整识别；图片选框不支持，请明确采用单位')
      else if (marked.length !== 1) unitIssues.push(marked.length ? '单位列两列均选中，请核对' : '单位列两列均未选中，请核对')
      if (selectedCol && (!selectedCell || !hasValue(selectedCell.display) || !rowUnit)) unitIssues.push('选中列的本行单位缺失，请核对')
      if (selectedCell?.formula) unitIssues.push('选中单位为未验证公式缓存，请核对')
      if (spec.absolute && /psid|psig|barg|\(g\)|表压/i.test(selectedCell?.display ?? '')) unitIssues.push('选中单位是压差或表压，不能作为绝对压力')
      if (rowUnit && !Object.hasOwn(spec.units, rowUnit)) unitIssues.push('选中单位尚不支持该换算')
      if (rowUnit && (explicit || percentFormat) && !equivalentUnit(key, rowUnit, unit)) unitIssues.push('选中单位与值内单位或百分比格式存在冲突')
    }
    const unitBasis = { kind: spec.text ? 'not_applicable' : 'column_selection',
      chooseUnits: cellEvidence(choose), marks: marks.filter(Boolean).map(cellEvidence),
      selection: marked.map(cellEvidence), unitCell: selectedCell?.address, selectedUnit: rowUnit,
      selectedRaw: selectedCell?.raw, unitCells: unitCandidates,
      inline: explicit ? { text: explicit, address: value.address, unit: canonicalUnit(explicit) } : null,
      numberFormat: percentFormat ? { format: value.format, address: value.address, raw: value.raw, displayedPercent: percentage(value.raw) } : null,
      equivalentTemperatureDifference: Boolean(spec.temperatureDifference && explicit && rowUnit !== unit && equivalentUnit(key, rowUnit, unit)),
      status: unitIssues.length ? 'needs_user_review' : 'resolved', issues: unitIssues }
    const source = { fileId: meta.fileId, sha256: meta.sha256, indexSha256: meta.indexSha256, sheet: sheet.name, address: value.address, labelAddress: label.address,
      hidden: sheet.hidden, rowHidden: Boolean(sheet.rows?.[row-1]?.hidden), columnHidden: Boolean(sheet.columns?.[found.valueCol-1]?.hidden),
      merges: sheet.merges.filter(range => { const [start, end] = range.split(':').map(position); return start.row <= row && end.row >= row && start.col <= found.valueCol && end.col >= found.valueCol }) }
    const adopted = { value: percentFormat ? percentage(value.raw) : value.raw ?? value.display, unit: spec.text ? '' : unit,
      source: `${sheet.name}!${value.address}：${value.display}`.slice(0, 1200), absolute: spec.absolute ? /abs\.?|绝对|bar\(a\)|bara|psia/i.test(label.display+' '+value.display+' '+(selectedCell?.display ?? '')) : undefined }
    const parsed = normalizeRequirement(key, adopted)
    const review = [...parsed.issues, ...unitIssues, ...(!REQUIREMENT_FIELDS[key] ? ['字段未映射，按参考原文保留'] : []), ...(value.formula ? ['公式缓存未重新计算核验'] : [])]
    if (value.formula || unitIssues.length) parsed.entry.normalized = null
    records.push({ id: `${key}:${value.address}`, key, group: spec.group === 'test' ? 'test' : spec.boundary || key === 'refrigerant' ? 'main' : 'requirements',
      originalName: label.raw, raw: value.raw, display: value.display, cell: cellEvidence(value), unitCandidates, unitBasis, source,
      adopted: parsed.entry, issues: review, verification: 'unverified' })
  }
  return { template: 'condenser-requirements.v2', mappingId: CONDENSER_MAPPING.id, mappingVersion: CONDENSER_MAPPING.version,
    title: cellEvidence(found.title), sheet: sheet.name, records, issues,
    source: { fileId: meta.fileId, name: meta.name, sha256: meta.sha256, indexSha256: meta.indexSha256, sheet: sheet.name },
    recognition: { basis: 'title_and_field_structure', valueColumn: address(1, found.valueCol).replace(/1$/, ''), fieldCount: found.anchors.length } }
}
