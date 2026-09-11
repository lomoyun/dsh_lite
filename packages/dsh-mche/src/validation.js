export class McheError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; this.code = 'MCHE_INVALID' }
}
export const conflict = (message = '版本已更新，请重新打开详情后确认') => new McheError(message, 409)
export function object(input, keys) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new McheError('请求必须是对象')
  for (const key of Object.keys(input)) if (!keys.includes(key)) throw new McheError(`未知字段：${key}`)
  return input
}
export function session(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(value)) throw new McheError('会话标识无效')
  return value
}
export function text(value, max = 1000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new McheError('文本为空或过长')
  return value
}
export function positive(value, integer = false, allowZero = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (!allowZero && value === 0)) throw new McheError(allowZero ? '数值必须为有限非负数' : '数值必须为有限正数')
  if (integer && !Number.isSafeInteger(value)) throw new McheError('数量必须为安全正整数')
  return value
}
export function range(value, integer = false, allowZero = false) {
  if (typeof value === 'number') return positive(value, integer, allowZero)
  object(value, ['min', 'max'])
  if (!Object.keys(value).length) throw new McheError('范围缺少上下限')
  for (const bound of Object.values(value)) positive(bound, integer, allowZero)
  if (value.min !== undefined && value.max !== undefined && value.min > value.max) throw new McheError('范围下限超过上限')
  return value
}
export function within(value, constraint) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  if (typeof constraint === 'number') return Math.abs(value - constraint) <= Math.max(1, Math.abs(constraint)) * 1e-10
  return (constraint.min === undefined || value >= constraint.min) && (constraint.max === undefined || value <= constraint.max)
}
export function pagination(input) {
  const offset = input.offset ?? 0, limit = input.limit ?? 20
  if (!Number.isSafeInteger(offset) || offset < 0) throw new McheError('分页起点无效')
  positive(limit, true)
  if (limit > 100) throw new McheError('每页最多 100 个型号')
  return { offset, limit }
}
