const length = (label, geometry) => ({ label, geometry, component: 'fin', unit: 'mm', units: { mm: 1, cm: 10, m: 1000 }, range: true })
export const FIN_SECTIONS = { main: '主表', tube_insert: '穿管模具', dongsheng: '东升设备（基本无法使用）', cross_insert: '横插翅片' }
export const FIN_INPUT_FIELDS = {
  finSection: { label: '翅片分区', component: 'fin', unit: '', text: true, options: FIN_SECTIONS },
  finThickness: length('翅片料厚约束', 'thicknessMm'),
  finWidth: length('翅片宽度约束（主表）', 'widthMm'),
  finStockWidth: length('翅片料宽约束（穿管/横插）', 'stockWidthMm'),
  finHeightPreBrazing: length('翅片焊前高度约束', 'heightPreBrazingMm'),
  finHeightPostBrazing: length('翅片焊后高度约束', 'heightPostBrazingMm'),
  finPitch: length('翅片片距约束', 'finPitchMm'),
  finSlotPitch: length('翅片槽间距约束（横插）', 'slotPitchMm'),
  finSlotLength: length('翅片扁槽长度约束', 'slotLengthMm'),
  finSlotWidth: length('翅片扁槽宽度约束（横插）', 'slotWidthMm'),
  finLouverLengthFull: length('翅片开窗长度 Full 约束', 'louverLengthFullMm'),
  finLouverLengthOverall: length('翅片开窗长度 Overall 约束', 'louverLengthOverallMm'),
  finLouverPitch: length('翅片开窗间距约束', 'louverPitchMm'),
  finLouverAngle: { label: '翅片开窗角度约束', component: 'fin', geometry: 'louverAngleDeg', unit: '°', units: { '°': 1 }, range: true, allowZero: true },
  finLouverCount: { label: '翅片开窗个数约束', component: 'fin', geometry: 'louverCount', unit: '个', units: { '个': 1 }, range: true, integer: true, allowZero: true },
}
export const FIN_CONSTRAINT_FIELDS = [...Object.keys(FIN_INPUT_FIELDS), 'application', 'operatingConditions']
export const FIN_GEOMETRY_FILTERS = Object.fromEntries(Object.values(FIN_INPUT_FIELDS).filter(f => f.geometry).map(f => [f.geometry, f]))
