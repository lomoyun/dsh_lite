import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { McheError, object, text, range, pagination, within } from './validation.js'
import { REFRIGERANT_CATEGORIES, CONCENTRATION_BASES } from './refrigerant-fields.js'
export async function loadRefrigerantCatalog(path) {
  const bytes = await readFile(path), catalog = JSON.parse(bytes)
  if (catalog.schemaVersion !== 1 || catalog.catalogId !== 'refrigerants' || !catalog.source || !catalog.fields || !catalog.count ||
      Object.keys(catalog.byName ?? {}).length !== catalog.count || Object.values(catalog.byName).some(r => !r.evidence || !Array.isArray(r.review))) throw new McheError('冷媒目录格式无效', 503)
  return { ...catalog, catalogDigest: createHash('sha256').update(bytes).digest('hex') }
}
export function getRefrigerantRecord(catalog, name) {
  text(name, 80)
  if (!Object.hasOwn(catalog.byName, name)) throw new McheError(`冷媒标识不存在：${name}（按原表精确匹配）`)
  const { headers, ...source } = catalog.source
  return { catalogId: catalog.catalogId, catalogDigest: catalog.catalogDigest, fields: catalog.fields, source, refrigerant: catalog.byName[name] }
}
export function summarizeRefrigerant(record) { const { evidence, ...summary } = record; return summary }
export function concentrationRange(value) {
  range(value, false, true)
  if ((typeof value === 'number' ? [value] : Object.values(value)).some(v => v > 100)) throw new McheError('浓度必须在0%到100%之间')
}
export function searchRefrigerantCatalog(catalog, input) {
  object(input, ['sessionId', 'nameContains', 'sequence', 'category', 'concentrationPercent', 'concentrationBasis', 'offset', 'limit'])
  const { offset, limit } = pagination(input)
  if (input.nameContains !== undefined) text(input.nameContains, 80)
  if (input.sequence !== undefined && (!Number.isSafeInteger(input.sequence) || input.sequence < 1)) throw new McheError('冷媒序号应为正整数')
  if (input.category !== undefined && !Object.hasOwn(REFRIGERANT_CATEGORIES, input.category)) throw new McheError('冷媒类别无效')
  if (input.concentrationBasis !== undefined && !Object.hasOwn(CONCENTRATION_BASES, input.concentrationBasis)) throw new McheError('浓度基准无效，Vol.与Wt.不可混用')
  if (input.concentrationPercent !== undefined) concentrationRange(input.concentrationPercent)
  const matches = Object.values(catalog.byName).filter(r => (input.nameContains === undefined || r.name.includes(input.nameContains)) &&
    (input.sequence === undefined || r.sequence === input.sequence) && (input.category === undefined || r.categoryKey === input.category) &&
    (input.concentrationBasis === undefined || r.concentrationBasis === input.concentrationBasis) &&
    (input.concentrationPercent === undefined || within(r.concentrationPercent, input.concentrationPercent) === true))
  return { catalogId: catalog.catalogId, catalogDigest: catalog.catalogDigest, total: matches.length,
    nextOffset: offset + limit < matches.length ? offset + limit : null, items: matches.slice(offset, offset + limit).map(summarizeRefrigerant) }
}
