export class InputError extends Error {}
export const NS = 'model-config-ui'
export const MAX_BODY_BYTES = 32_768

export function text(value, label, max = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new InputError(`${label}不能为空，且不能超过 ${max} 个字符`)
  }
  return value.trim()
}

export function positive(value, label) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 10_000_000) {
    throw new InputError(`${label}必须是 1–10000000 之间的整数`)
  }
  return value
}

export function endpoint(value) {
  const raw = text(value, 'API 地址', 2000)
  let url
  try { url = new URL(raw) } catch { throw new InputError('API 地址格式无效') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new InputError('API 地址必须是 HTTP(S) 地址，且不能包含凭据、查询参数或片段')
  }
  return raw
}

export function routeId(value) {
  const id = text(value, '提供方 ID', 80)
  if (!/^[a-z][a-z0-9-]*$/.test(id) || ['constructor', 'prototype'].includes(id)) {
    throw new InputError('提供方 ID 仅支持小写字母、数字和连字符')
  }
  return id
}

export function keyReference(value) {
  const ref = text(value, '密钥引用', 100)
  if (!/^[A-Z_][A-Z0-9_]*$/.test(ref)) throw new InputError('密钥引用仅支持大写字母、数字和下划线')
  return ref
}

export function revision(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new InputError('配置版本无效，请刷新页面')
  return value
}
