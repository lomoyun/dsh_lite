import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { McheError, object, pagination, range, text, within } from './validation.js'

export async function loadCatalog(path) {
  const bytes = await readFile(path)
  const catalog = JSON.parse(bytes)
  if (catalog.schemaVersion !== 1 || catalog.catalogId !== 'flat-tubes' || !catalog.fields || !catalog.source ||
    Object.keys(catalog.byName ?? {}).length !== catalog.count) throw new McheError('扁管目录格式无效，已停止读取', 503)
  return { ...catalog, catalogDigest: createHash('sha256').update(bytes).digest('hex') }
}
export function getTube(catalog, name) {
  text(name, 80)
  if (!Object.hasOwn(catalog.byName, name)) throw new McheError(`扁管型号不存在：${name}（名称须精确匹配）`)
  return { catalogId: catalog.catalogId, catalogDigest: catalog.catalogDigest, source: catalog.source,
    fields: catalog.fields, tube: catalog.byName[name] }
}
export function searchCatalog(catalog, input) {
  object(input, ['sessionId', 'widthMm', 'heightMm', 'portCount', 'nameContains', 'offset', 'limit'])
  const { offset, limit } = pagination(input)
  const keys = ['widthMm', 'heightMm', 'portCount'].filter((key) => input[key] !== undefined)
  keys.forEach((key) => range(input[key], key === 'portCount'))
  if (input.nameContains !== undefined) text(input.nameContains, 80)
  const matches = Object.values(catalog.byName).filter((tube) =>
    (!input.nameContains || tube.name.includes(input.nameContains)) && keys.every((key) => within(tube.geometry[key], input[key]) === true))
  return { catalogId: catalog.catalogId, catalogDigest: catalog.catalogDigest, source: catalog.source, fields: catalog.fields,
    total: matches.length, nextOffset: offset + limit < matches.length ? offset + limit : null,
    items: matches.slice(offset, offset + limit).map(({ evidence: _evidence, ...tube }) => tube) }
}
export function reviewGroups(tube) {
  return { conflicts: tube.review.filter((item) => item.code !== 'non_scalar_geometry'),
    unknownGeometry: tube.review.filter((item) => item.code === 'non_scalar_geometry') }
}
