import { randomUUID } from 'node:crypto'
import { CONSTRAINT_FIELDS, INPUT_FIELDS } from './inputs.js'
import { getTube, reviewGroups } from './catalog.js'
import { McheError, pagination, within } from './validation.js'
import { constraintKeys, recommendationBasis } from './recommendation-context.js'

function check(tube, field, input) {
  const expected = input.normalized.value
  if (INPUT_FIELDS[field].geometry) {
    const actual = tube.geometry[INPUT_FIELDS[field].geometry]
    return { field, expected, actual, match: within(actual, expected), message: `${INPUT_FIELDS[field].label}按目录数值比较` }
  }
  if (field === 'designPressure') {
    const actual = tube.selection.designPressureMpa
    const match = typeof actual === 'number' && Number.isFinite(actual) ? actual >= expected : null
    return { field, expected, actual, match, message: '仅比较原表明确数值压力；复杂压力描述未解释，不能证明实际耐压' }
  }
  return { field, expected, actual: tube.selection.application, match: null, message: '原表应用描述供核对，未验证场景适用性' }
}
export function assessTube(tube, state) {
  const checks = constraintKeys(state, 'tube').map((key) => ({ ...check(tube, key, state.draft[key]),
    basis: state.confirmed[key] ? 'confirmed' : 'draft', source: state.draft[key].source }))
  const unknown = checks.filter((item) => item.match === null)
  for (const [field, label] of [['performance', '性能'], ['cost', '成本'], ['availability', '供货']]) {
    unknown.push({ field, message: `${label}：没有已验证资料，不评分或排名` })
  }
  return { name: tube.name, geometry: tube.geometry, selection: tube.selection, sourceRange: tube.sourceRange,
    review: tube.review, ...reviewGroups(tube), satisfied: checks.filter((item) => item.match === true),
    unmet: checks.filter((item) => item.match === false), unknown }
}
export function recommendations(catalog, state, input) {
  const { offset, limit } = pagination(input)
  if (input.names && (!Array.isArray(input.names) || !input.names.length || input.names.length > 100)) throw new McheError('比较型号应为 1 到 100 个精确名称')
  const tubes = input.names ? [...new Set(input.names)].map((name) => getTube(catalog, name).tube) : Object.values(catalog.byName)
  const assessed = tubes.map((tube) => assessTube(tube, state))
  const matches = input.names ? assessed : assessed.filter((tube) => !tube.unmet.length)
  const hasConditions = CONSTRAINT_FIELDS.some((key) => state.draft[key])
  const draft = CONSTRAINT_FIELDS.some((key) => state.draft[key] && !state.confirmed[key])
  return { id: randomUUID(), component: 'tube', inputVersion: state.componentVersions.tube, catalogDigest: catalog.catalogDigest,
    basisSummary: recommendationBasis(state, 'tube', catalog.catalogDigest),
    ...(input.names ? { names: [...new Set(input.names)] } : {}),
    basis: !hasConditions ? 'no_conditions' : draft ? 'draft' : 'confirmed',
    policy: '同等满足条件的型号并列；保留原目录顺序，无性能、成本或供货排序',
    total: matches.length, excluded: assessed.length - matches.length,
    nextOffset: offset + limit < matches.length ? offset + limit : null, items: matches.slice(offset, offset + limit) }
}
