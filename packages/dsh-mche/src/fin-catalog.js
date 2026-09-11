import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { FIN_GEOMETRY_FILTERS, FIN_SECTIONS } from './fin-fields.js'
import { McheError, object, pagination, range, text, within } from './validation.js'

export async function loadFinCatalog(path) {
  const bytes = await readFile(path), catalog = JSON.parse(bytes)
  if (catalog.schemaVersion !== 1 || catalog.catalogId !== 'fins' || !catalog.sections || !catalog.source ||
      Object.keys(catalog.byName ?? {}).length !== catalog.count || !catalog.count ||
      Object.values(catalog.byName).some(fin => !catalog.sections[fin.section]?.fields || !fin.geometry || !fin.evidence || !Array.isArray(fin.review))) {
    throw new McheError('翅片目录格式无效，已停止读取', 503)
  }
  return { ...catalog, catalogDigest: createHash('sha256').update(bytes).digest('hex') }
}
function sourceOf(catalog) { const { headers, ...source } = catalog.source; return source }
export function getFinRecord(catalog, name) {
  text(name, 80)
  if (!Object.hasOwn(catalog.byName, name)) throw new McheError(`翅片型号不存在：${name}（名称须精确匹配）`)
  const fin = catalog.byName[name], section = catalog.sections[fin.section]
  return { catalogId: catalog.catalogId, catalogDigest: catalog.catalogDigest, source: sourceOf(catalog),
    fields: section.fields, section: { key: fin.section, label: section.label, titleCell: section.titleCell }, fin,
    ...finReviewGroups(fin) }
}
export function summarizeFin(fin) {
  const { evidence, ...summary } = fin
  return { ...summary, sectionLabel: FIN_SECTIONS[fin.section], geometryText: Object.fromEntries(Object.keys(fin.geometry).map(key => [key, evidence[key]?.display ?? ''])) }
}
export function searchFinCatalog(catalog, input) {
  object(input, ['sessionId', 'nameContains', 'code', 'section', 'offset', 'limit', ...Object.keys(FIN_GEOMETRY_FILTERS)])
  const { offset, limit } = pagination(input)
  if (input.code !== undefined) text(input.code, 80)
  if (input.nameContains !== undefined) text(input.nameContains, 80)
  if (input.section !== undefined && !Object.hasOwn(FIN_SECTIONS, input.section)) throw new McheError('未知翅片分区')
  const keys = Object.keys(FIN_GEOMETRY_FILTERS).filter(key => input[key] !== undefined)
  for (const key of keys) range(input[key], FIN_GEOMETRY_FILTERS[key].integer, FIN_GEOMETRY_FILTERS[key].allowZero)
  const matches = Object.values(catalog.byName).filter(fin => (!input.nameContains || fin.name.includes(input.nameContains)) &&
    (input.code === undefined || fin.code === input.code) && (input.section === undefined || fin.section === input.section) &&
    keys.every(key => within(fin.geometry[key], input[key]) === true))
  return { catalogId: catalog.catalogId, catalogDigest: catalog.catalogDigest, source: sourceOf(catalog), total: matches.length,
    nextOffset: offset + limit < matches.length ? offset + limit : null, items: matches.slice(offset, offset + limit).map(fin => ({ ...summarizeFin(fin), ...finReviewGroups(fin) })) }
}
export function finReviewGroups(fin) {
  const conflicts = new Set(['invalid_geometry_number', 'brazing_change_mismatch', 'r_exceeds_dimensions', 'pitch_outside_sample_range'])
  const restrictions = new Set(['source_restriction', 'section_restriction'])
  const groups = { conflicts: [], unknownGeometry: [], specifications: [], restrictions: [], notes: [] }
  for (const item of fin.review) {
    if (conflicts.has(item.code)) groups.conflicts.push(item)
    else if (restrictions.has(item.code)) groups.restrictions.push(item)
    else if (item.code === 'non_scalar_geometry') {
      const raw = fin.evidence[item.field]?.raw
      const constrained = typeof raw === 'string' && (item.field === 'finPitchRangeMm' || /^[≤≥<>]/.test(raw.trim())) && raw.trim()
      groups[constrained ? 'specifications' : 'unknownGeometry'].push(item)
    } else groups.notes.push(item)
  }
  return groups
}
