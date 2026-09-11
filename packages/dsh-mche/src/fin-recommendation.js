import { randomUUID } from 'node:crypto'
import { FIN_CONSTRAINT_FIELDS, FIN_INPUT_FIELDS } from './fin-fields.js'
import { getFinRecord, summarizeFin, finReviewGroups } from './fin-catalog.js'
import { McheError, pagination, within } from './validation.js'
import { constraintKeys, recommendationBasis } from './recommendation-context.js'

export function assessFin(fin, state) {
  const checks = constraintKeys(state, 'fin').map(field => {
    const input = state.draft[field], definition = FIN_INPUT_FIELDS[field], expected = input.normalized.value
    const actual = field === 'finSection' ? fin.section : definition?.geometry ? fin.geometry[definition.geometry] ?? null : null
    const match = field === 'finSection' ? actual === expected : definition?.geometry ? within(actual, expected) : null
    return { field, expected, actual, match, basis: state.confirmed[field] ? 'confirmed' : 'draft', source: input.source,
      message: definition ? `${definition.label}按原表分区及明确数值比较` : '工况与翅片适用性未建立验证规则' }
  })
  const unknown = checks.filter(item => item.match === null)
  unknown.push(...['性能', '成本', '当前供货', '扁管与翅片装配匹配'].map(message => ({ message: `${message}未验证，不评分或判定通过` })))
  if (!state.draft.finSection) unknown.push({ field: 'finSection', message: '尚未指定翅片分区；不同结构的候选不能视为可互换' })
  return { ...summarizeFin(fin), ...finReviewGroups(fin), satisfied: checks.filter(item => item.match === true), unmet: checks.filter(item => item.match === false), unknown }
}
export function finRecommendations(catalog, state, input) {
  const { offset, limit } = pagination(input)
  if (input.names && (!Array.isArray(input.names) || !input.names.length || input.names.length > 100)) throw new McheError('比较型号应为 1 到 100 个精确名称')
  const fins = input.names ? [...new Set(input.names)].map(name => getFinRecord(catalog, name).fin) : Object.values(catalog.byName)
  const assessed = fins.map(fin => assessFin(fin, state)), matches = input.names ? assessed : assessed.filter(fin => !fin.unmet.length)
  const conditions = FIN_CONSTRAINT_FIELDS.filter(key => state.draft[key])
  return { id: randomUUID(), component: 'fin', inputVersion: state.componentVersions.fin, catalogDigest: catalog.catalogDigest,
    basisSummary: recommendationBasis(state, 'fin', catalog.catalogDigest),
    ...(input.names ? { names: [...new Set(input.names)] } : {}), basis: !conditions.length ? 'no_conditions' : conditions.some(key => !state.confirmed[key]) ? 'draft' : 'confirmed',
    policy: '仅比较明确条件；不同分区不能互换；目录范围、缺项、使用限制均保留，无性能、成本或供货排名',
    total: matches.length, excluded: assessed.length - matches.length, nextOffset: offset + limit < matches.length ? offset + limit : null,
    items: matches.slice(offset, offset + limit) }
}
