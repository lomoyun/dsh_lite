import { McheError, object, positive, range, text } from './validation.js'
import { FIN_INPUT_FIELDS } from './fin-fields.js'
import { REFRIGERANT_INPUT_FIELDS } from './refrigerant-fields.js'

const lengthUnits = { mm: 1, cm: 10, m: 1000 }
const length = (label, extra = {}) => ({ label, unit: 'mm', units: lengthUnits, ...extra })
export const INPUT_FIELDS = {
  tubeWidth: length('管宽约束', { range: true, geometry: 'widthMm' }),
  tubeHeight: length('管高约束', { range: true, geometry: 'heightMm' }),
  portCount: { label: '孔数约束', unit: '个', units: { '个': 1 }, integer: true, range: true, geometry: 'portCount' },
  tubeLength: length('管长', { required: true }),
  tubeCount: { label: '管数', unit: '个', units: { '个': 1 }, integer: true, required: true },
  tubePitch: length('管间距（含义待映射）', { required: true }),
  designPressure: { label: '设计压力', unit: 'MPa', units: { MPa: 1, kPa: 0.001, Pa: 0.000001, bar: 0.1 } },
  application: { label: '应用场景', unit: '', text: true },
  operatingConditions: { label: '其他工况原文（未映射）', unit: '', text: true },
  ...FIN_INPUT_FIELDS,
  ...REFRIGERANT_INPUT_FIELDS,
}
export const CONSTRAINT_FIELDS = ['tubeWidth', 'tubeHeight', 'portCount', 'designPressure', 'application']
export const REQUIRED_FIELDS = Object.keys(INPUT_FIELDS).filter((key) => INPUT_FIELDS[key].required)
export function normalizeEntry(key, input, origin) {
  const field = INPUT_FIELDS[key]
  object(input, ['value', 'unit', 'source'])
  text(input.source)
  if (field.text) {
    if (input.unit !== '') throw new McheError(`${field.label}不接受数值单位`)
    if (field.options && !Object.hasOwn(field.options, input.value)) throw new McheError(`${field.label}取值无效`)
    return { ...input, normalized: { value: text(input.value, 4000), unit: '' }, origin, sourceVerified: origin === 'user' }
  }
  if (!Object.hasOwn(field.units, input.unit)) throw new McheError(`${field.label}单位只支持 ${Object.keys(field.units).join(' / ')}`)
  const raw = field.range ? range(input.value, field.integer, field.allowZero) : positive(input.value, field.integer, field.allowZero)
  if (field.max !== undefined && (typeof raw === 'number' ? [raw] : Object.values(raw)).some(v => v > field.max)) throw new McheError(`${field.label}不能大于${field.max}${field.unit}`)
  const convert = (value) => positive(value * field.units[input.unit], field.integer, field.allowZero)
  const value = typeof raw === 'number' ? convert(raw) : Object.fromEntries(Object.entries(raw).map(([key, bound]) => [key, convert(bound)]))
  return { ...input, normalized: { value, unit: field.unit }, origin, sourceVerified: origin === 'user' }
}
export function draftChanges(changes, origin) {
  object(changes, Object.keys(INPUT_FIELDS))
  if (!Object.keys(changes).length) throw new McheError('至少提供一个草稿字段')
  return Object.fromEntries(Object.entries(changes).map(([key, entry]) => [key, entry === null ? null : normalizeEntry(key, entry, origin)]))
}
export function missingInputs(state) {
  return [...new Set([...REQUIRED_FIELDS, ...Object.keys(state.draft)])].filter((key) => !state.confirmed[key]).map((key) => ({
    code: state.draft[key] ? 'input_unconfirmed' : 'input_missing', field: key,
    message: `${INPUT_FIELDS[key].label}${state.draft[key] ? '尚未确认' : '尚未提供'}`,
  }))
}
