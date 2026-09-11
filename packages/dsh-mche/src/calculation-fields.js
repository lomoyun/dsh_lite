import { McheError, object, text } from './validation.js'

const length = { mm: [0.001, 0], cm: [0.01, 0], m: [1, 0] }
const pressure = { Pa: [1, 0], kPa: [1000, 0], MPa: [1e6, 0], bar: [1e5, 0] }
const temperature = { '°C': [1, 273.15], K: [1, 0] }
const field = (label, group, unit, units, extra = {}) => ({ label, group, unit, units,
  normalizedUnit: units === length ? 'm' : units === pressure ? 'Pa' : units === temperature ? 'K' : Object.keys(units).find(k => units[k][0] === 1 && units[k][1] === 0),
  required: true, min: 0, exclusiveMin: true, ...extra })
const choice = (label, options, extra = {}) => ({ label, group: 'engineering', unit: '', options, required: true, ...extra })
export const CALCULATION_FIELDS = {
  refPressure: field('冷媒入口绝对压力', 'conditions', 'kPa', pressure),
  refTemperature: field('冷媒入口温度', 'conditions', '°C', temperature),
  refMassFlow: field('冷媒质量流量', 'conditions', 'kg/h', { 'kg/h': [1/3600, 0], 'kg/s': [1, 0], 'g/s': [0.001, 0] }),
  airPressure: field('空气入口绝对压力', 'conditions', 'Pa', pressure),
  airTemperature: field('空气入口干球温度', 'conditions', '°C', temperature),
  airHumidity: field('空气入口相对湿度', 'conditions', '%', { '%': [1, 0], fraction: [100, 0] }, { exclusiveMin: false, max: 100 }),
  airVolumeFlow: field('空气体积流量', 'conditions', 'm3/h', { 'm3/h': [1/3600, 0], 'm3/s': [1, 0], 'L/s': [0.001, 0] }),
  tubeCount: field('扁管数量', 'conditions', '个', { '个': [1, 0] }, { integer: true, max: 500 }),
  finnedLength: field('每根管带翅片长度', 'conditions', 'mm', length),
  unfinnedLength: field('每根管无翅片总长度', 'conditions', 'mm', length, { exclusiveMin: false }),
  refDirection: choice('冷媒入口方向', { left: '左侧入口', right: '右侧入口' }, { group: 'conditions' }),
  airDirection: choice('空气流向', { left_to_right: '从左向右', right_to_left: '从右向左' }, { group: 'conditions' }),
  portShape: choice('孔型表达', { rectangular: '均匀矩形孔', circular: '圆孔（映射未验证）', specified: '指定截面（映射未验证）', unknown: '未知孔型' }),
  finStructure: choice('翅片结构核对', { louver: '均匀百叶窗翅片', plain: '平翅片（映射未验证）', unknown: '结构未确认' }),
  finHeightBasis: choice('DLL 翅片高度取值', { heightPreBrazingMm: '焊前高度', heightPostBrazingMm: '焊后高度', supplement: '工程补充' }),
  finDepthBasis: choice('DLL 翅片深度取值', { widthMm: '原表 Fin Width', supplement: '工程补充（不使用料宽）' }),
  louverLengthBasis: choice('DLL 开窗长度取值', { louverLengthFullMm: '原表 Full', louverLengthOverallMm: '原表 Overall', supplement: '工程补充' }),
  finPitchBasis: choice('FPI 定义', { pitch: '片距是节距：25.4 / 节距(mm)', clear_gap: '片距是净间距：25.4 / (净间距 + 厚度)(mm)', fpi: '直接提供 FPI' }),
  finConductivity: field('翅片导热系数', 'engineering', 'W/(m K)', { 'W/(m K)': [1, 0] }),
  assemblyEvidence: { label: '装配及长度含义核对说明', group: 'engineering', unit: '', text: true, required: true },
  finUnitEvidence: { label: '翅片分区及单位核对依据', group: 'engineering', unit: '', text: true, required: true },
  finFpi: field('工程提供 FPI', 'engineering', '1/in', { '1/in': [1, 0] }, { required: false }),
}
for (const [key, label] of Object.entries({ tubeWidth: '采用管宽', tubeHeight: '采用管高', portWidth: '采用孔宽', portHeight: '采用孔高',
  finThickness: '采用翅片厚度', finHeight: '补充翅片高度', finDepth: '补充翅片深度', finPitch: '采用片距', louverLength: '补充开窗长度', louverPitch: '采用开窗间距' })) {
  CALCULATION_FIELDS[key] = field(label, 'engineering', 'mm', length, { required: false })
}
CALCULATION_FIELDS.portCount = field('采用孔数', 'engineering', '个', { '个': [1, 0] }, { required: false, integer: true, max: 500 })
CALCULATION_FIELDS.louverCount = field('采用开窗数量', 'engineering', '个', { '个': [1, 0] }, { required: false, integer: true, exclusiveMin: false, max: 1000 })
CALCULATION_FIELDS.louverAngle = field('采用开窗角度', 'engineering', '°', { '°': [1, 0], rad: [180/Math.PI, 0] }, { required: false, exclusiveMin: false, max: 90 })

export function calculationChanges(changes, origin) {
  object(changes, Object.keys(CALCULATION_FIELDS))
  return Object.fromEntries(Object.entries(changes).map(([key, entry]) => {
    if (entry === null) return [key, null]
    const spec = CALCULATION_FIELDS[key]
    object(entry, ['value', 'unit', 'source']); text(entry.source, 1200)
    let normalized = entry.value
    if (spec.options || spec.text) {
      text(entry.value, 2000)
      if (entry.unit !== '' || (spec.options && !Object.hasOwn(spec.options, entry.value))) throw new McheError(`${spec.label}选项或单位无效`)
    } else {
      if (typeof entry.value !== 'number' || !Number.isFinite(entry.value) || !Object.hasOwn(spec.units, entry.unit)) throw new McheError(`${spec.label}数值或单位无效`)
      const [factor, offset] = spec.units[entry.unit]; normalized = entry.value * factor + offset
      if (!Number.isFinite(normalized) || normalized < spec.min || (spec.exclusiveMin && normalized === spec.min) || (spec.max !== undefined && normalized > spec.max) || (spec.integer && !Number.isSafeInteger(normalized))) throw new McheError(`${spec.label}超出允许范围（压力必须为绝压，温度按 K 校验）`)
    }
    return [key, { ...entry, normalized, normalizedUnit: spec.normalizedUnit ?? '', origin }]
  }))
}
