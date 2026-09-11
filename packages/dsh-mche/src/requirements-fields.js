import { CALCULATION_FIELDS } from './calculation-fields.js'

const numeric = (label, unit, units, extra = {}) => ({ label, unit, units, normalizedUnit: unit, min: 0, ...extra })
const delta = { K: [1, 0], '°C': [1, 0], '°F': [5/9, 0] }
const length = { mm: [1, 0], cm: [10, 0], m: [1000, 0], in: [25.4, 0] }
const pressure = { Pa: [1, 0], kPa: [1000, 0], MPa: [1e6, 0], bar: [1e5, 0], psi: [6894.757293168, 0] }
export const REQUIREMENT_FIELDS = Object.fromEntries(['refPressure', 'refTemperature', 'refMassFlow', 'airPressure', 'airTemperature', 'airHumidity', 'airVolumeFlow']
  .map(key => [key, { ...CALCULATION_FIELDS[key], boundary: true, absolute: key.endsWith('Pressure') }]))
Object.assign(REQUIREMENT_FIELDS, {
  refQuality: numeric('冷媒入口干度', 'fraction', { fraction: [1, 0], '%': [0.01, 0] }, { max: 1, boundary: true }),
  refSatTemperature: { ...CALCULATION_FIELDS.refTemperature, label: '冷媒饱和温度', boundary: true },
  refSuperheat: numeric('冷媒入口过热度', 'K', delta, { boundary: true, temperatureDifference: true }),
  refSubcooling: numeric('冷媒出口过冷度', 'K', delta, { boundary: true, temperatureDifference: true }),
  refOutletTemperature: { ...CALCULATION_FIELDS.refTemperature, label: '冷媒出口温度', boundary: true },
  airWetBulb: { ...CALCULATION_FIELDS.airTemperature, label: '空气入口湿球温度', boundary: true },
  airHumidityRatio: numeric('空气入口含湿量', 'kg/kg', { 'kg/kg': [1, 0], 'g/kg': [0.001, 0] }, { boundary: true }),
  airVelocity: numeric('空气迎面风速', 'm/s', { 'm/s': [1, 0], 'ft/s': [0.3048, 0] }, { exclusiveMin: true, boundary: true }),
  heatLoad: numeric('目标换热量', 'W', { W: [1, 0], kW: [1000, 0], 'Btu/h': [0.29307107017222, 0] }, { target: true }),
  refPressureDrop: numeric('冷媒侧压降上限', 'Pa', pressure, { target: true }),
  airPressureDrop: numeric('空气侧压降上限', 'Pa', pressure, { target: true }),
  airAngle: numeric('空气与盘管面的夹角', '°', { '°': [1, 0], rad: [180/Math.PI, 0] }, { max: 180 }),
})
for (const key of ['refTemperature', 'refSatTemperature', 'refOutletTemperature', 'airTemperature', 'airWetBulb']) REQUIREMENT_FIELDS[key].units = { ...REQUIREMENT_FIELDS[key].units, '°F': [5/9, 273.15 - 32*5/9] }
for (const key of ['refPressure', 'airPressure']) REQUIREMENT_FIELDS[key].units = pressure
REQUIREMENT_FIELDS.refMassFlow.units = { ...REQUIREMENT_FIELDS.refMassFlow.units, 'lbm/h': [0.45359237/3600, 0] }
REQUIREMENT_FIELDS.airVolumeFlow.units = { ...REQUIREMENT_FIELDS.airVolumeFlow.units, ACFM: [0.028316846592/60, 0] }
for (const [key, label] of Object.entries({ spaceLength: '盘管可用空间长度', spaceHeight: '集管高度', spaceDepth: '深度或集管直径', existingTubeWidth: '现用扁管宽度', inletPipeSize: '入口管径', outletPipeSize: '出口管径', bendingRadius: '内弯半径' })) REQUIREMENT_FIELDS[key] = numeric(label, 'mm', length, { target: true })
for (const [key, label] of Object.entries({ customer: '客户及项目', refrigerant: '需求介质', lengthIncludesHeaders: '长度是否含集管/弯头', lengthIncludesConnections: '长度是否含连接', areaPreference: '迎风面积偏好', sameAreaGoal: '等面积优化目标', smallerAreaGoal: '缩小尺寸偏好', existingCoil: '现用换热器', existingTubeFin: '现用管翅排数及管径', connectionSide: '接管侧要求', finPitchLimit: '翅片间距限制', coilShape: '成品形状', bracket: '安装支架', installation: '固定及安装', background: '项目背景', application: '设备应用', environment: '工作环境', environmentalProtection: '环保要求', dust: '积尘要求', appearance: '外观要求', certification: '认证要求', fatigue: '疲劳试验要求', burstPressure: '爆破压力要求', testConditions: '测试条件及规范', corrosion: '腐蚀要求', fanCurve: '风机曲线' })) REQUIREMENT_FIELDS[key] = { label, text: true, unit: '', group: key === 'testConditions' ? 'test' : 'requirements' }

export const BOUNDARY_KEYS = Object.keys(REQUIREMENT_FIELDS).filter(key => REQUIREMENT_FIELDS[key].boundary)
export const PTM_KEYS = ['refPressure', 'refTemperature', 'refMassFlow', 'airPressure', 'airTemperature', 'airHumidity', 'airVolumeFlow']
export const hasValue = value => value !== null && value !== undefined && (typeof value !== 'string' || value.trim() !== '')
export function canonicalUnit(unit) {
  const key = String(unit ?? '').trim().replace(/³/g, '3').replace(/\s+/g, '').toLowerCase()
  const aliases = { oc: '°C', '°c': '°C', '℃': '°C', of: '°F', '°f': '°F', '℉': '°F', o: '°', deg: '°', 'bar(a)': 'bar', bara: 'bar', psia: 'psi', psid: 'psi', '--': '' }
  if (Object.hasOwn(aliases, key)) return aliases[key]
  return [...new Set(Object.values(REQUIREMENT_FIELDS).flatMap(f => Object.keys(f.units ?? {})))].find(u => u.toLowerCase().replace(/\s+/g, '') === key) ?? String(unit ?? '').trim()
}

export function equivalentUnit(key, left, right) {
  const a = canonicalUnit(left), b = canonicalUnit(right), spec = REQUIREMENT_FIELDS[key]
  if (a === b) return true
  return Boolean(spec?.temperatureDifference && spec.units[a] && spec.units[b] &&
    spec.units[a][0] === spec.units[b][0] && spec.units[a][1] === spec.units[b][1])
}

// Only lexical numbers and declared unit conversions. No property or engineering inference.
export function normalizeRequirement(key, entry) {
  const spec = REQUIREMENT_FIELDS[key] ?? { text: true }, issues = []
  if (!entry || !hasValue(entry.value)) return { entry: null, issues }
  const raw = entry.value, str = String(raw).trim()
  if (/[?？]|待确认|待核|tbd|unverified/i.test(str)) issues.push('原文有疑问或待核内容')
  if (spec.text) return { entry: { ...entry, normalized: raw, normalizedUnit: '' }, issues }
  const match = /^([+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)(?:e[+-]?\d+)?)\s*(.*?)$/i.exec(str)
  if (!match || /^[+-]?\d{1,3},\d{3}$/.test(match[1])) issues.push('数字格式不明确，需用户补填')
  const suffix = match?.[2] ?? '', unit = canonicalUnit(suffix || entry.unit)
  if (spec.absolute && /(?:\(g\)|barg|psig|psid|表压)/i.test(suffix || entry.unit)) issues.push('必须提供绝对压力，不能自动换算表压或压差')
  if (spec.absolute && entry.absolute === false) issues.push('压力基准未明确为绝压')
  if (!Object.hasOwn(spec.units, unit)) issues.push('单位依据缺失或尚不支持该换算')
  if (suffix && entry.unit && !equivalentUnit(key, entry.unit, unit)) issues.push('填写单位与值内单位不一致')
  if (issues.length) return { entry: { ...entry, normalized: null, normalizedUnit: spec.normalizedUnit }, issues }
  const value = Number(match[1].replace(',', '.')), [factor, offset] = spec.units[unit], normalized = value * factor + offset
  if (!Number.isFinite(normalized) || normalized < (spec.min ?? 0) || (spec.exclusiveMin && normalized === spec.min) || (spec.max !== undefined && normalized > spec.max)) issues.push('数值超出字段允许范围')
  return { entry: { ...entry, value, unit, normalized: issues.length ? null : normalized, normalizedUnit: spec.normalizedUnit,
    conversion: { factor, offset }, originalValue: raw }, issues }
}
