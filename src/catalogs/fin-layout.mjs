export const FIN_COLUMNS = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i)).concat('AA')
export const FIN_HEADER_ROWS = [1, 2, 3, 4, 5, 141, 142, 162, 167, 168]
const mainLabels = ['Fin Type', 'Code', 'Fin Gage', 'Fin Width', 'Fin Height Pre-Brazing', 'Change During Brazing',
  'Fin Height Post-Brazing', 'Fin Pitch', 'Range of  fin  pitch     (Just for sample)', 'R', 'Louver Length (Full)',
  'Louver Length (Overall)', 'Louver Pitch', 'Louver Angle', 'Louver Number', 'Drawing #for mold &Revison',
  'Old Drawing #&Revison', 'Status', 'Count of mold', 'Material', 'Clad', 'Weight Per Unit Length',
  'Product  Where Used', 'Process status']
const mainKeys = ['name', 'code', 'thicknessMm', 'widthMm', 'heightPreBrazingMm', 'brazingChangeMm',
  'heightPostBrazingMm', 'finPitchMm', 'finPitchRangeMm', 'rMm', 'louverLengthFullMm', 'louverLengthOverallMm',
  'louverPitchMm', 'louverAngleDeg', 'louverCount', 'drawing', 'oldDrawing', 'status', 'moldCount', 'material',
  'clad', 'weightPerLengthGm', 'product', 'processStatus']
const tubeHeaders = { A: '图号', B: 'ERP', C: '厚度', D: '料宽', H: '片距', I: '片距范围', L: '扁槽长度', N: '开窗角度', O: '开窗个数' }
const crossHeaders = { A: '横插翅片', C: '料厚', D: '料宽', E: '槽间距', H: '片距', I: '片距范围', L: '扁槽长度', M: '扁槽宽度', N: '开窗角度', O: '开窗个数' }
export const FIN_EXPECTED_HEADERS = {
  1: { C: 'Available', R: 'In acceptance', V: 'No Available' },
  2: Object.fromEntries(mainLabels.map((label, i) => [FIN_COLUMNS[i], label])),
  3: { C: 'F_gage', D: 'F_W', E: 'F_H', G: 'F_H', H: 'F_P', J: 'R', K: 'L_H', M: 'L_P', N: 'L_Angle', O: 'L_#', V: 'g/m' },
  4: { ...Object.fromEntries(FIN_COLUMNS.slice(2, 13).map(c => [c, 'mm'])), N: '°', S: 'ul' },
  5: {}, 141: { A: '穿管模具' }, 142: tubeHeaders,
  162: { A: '东升设备（模具存在，但基本无法使用）' }, 167: { A: '横插翅片' }, 168: crossHeaders,
}
function fieldsFor(headerRow = 2) {
  return Object.fromEntries(FIN_COLUMNS.map((column, i) => {
    const localGeometry = headerRow !== 2 && i >= 2 && i <= 14
    const localIdentity = headerRow !== 2 && i <= 1
    const label = (localGeometry || localIdentity) ? FIN_EXPECTED_HEADERS[headerRow][column] ?? null : mainLabels[i] ?? null
    let key = mainKeys[i] ?? `sourceColumn${column}`
    if (localGeometry && !label) key = `sourceColumn${column}`
    if (localGeometry && column === 'D') key = 'stockWidthMm'
    if (localGeometry && column === 'L') key = 'slotLengthMm'
    if (headerRow === 168 && column === 'E') key = 'slotPitchMm'
    if (headerRow === 168 && column === 'M') key = 'slotWidthMm'
    const group = i <= 1 ? 'identity' : i <= 14 && label ? 'geometry' : label ? 'selection' : 'unclassified'
    const unit = group === 'geometry' ? (i === 13 ? '°' : i === 14 ? null : 'mm') : column === 'V' ? 'g/m' : column === 'S' ? 'ul' : null
    return [key, { column, label, unit, group,
      headerCell: `${column}${localGeometry || localIdentity ? headerRow : 2}`,
      unitCell: unit ? `${column}${column === 'V' ? 3 : 4}` : null,
      unitBasis: unit ? headerRow !== 2 && group === 'geometry' ? 'workbook_column_unit_inherited' : 'explicit_source_unit' : 'not_stated' }]
  }))
}
export const FIN_SECTIONS = {
  main: { label: '主表', firstRow: 6, lastRow: 140, headerRow: 2, titleCell: null, fields: fieldsFor() },
  tube_insert: { label: '穿管模具', firstRow: 143, lastRow: 161, headerRow: 142, titleCell: 'A141', fields: fieldsFor(142) },
  dongsheng: { label: '东升设备（模具存在，但基本无法使用）', firstRow: 163, lastRow: 166, headerRow: 2, titleCell: 'A162', fields: fieldsFor() },
  cross_insert: { label: '横插翅片', firstRow: 169, lastRow: 174, headerRow: 168, titleCell: 'A167', fields: fieldsFor(168) },
}
