import { McheError, object, text } from './validation.js'

export function projectTopology(calculation = {}) {
  if (calculation.topology) return structuredClone(calculation.topology)
  const draft = calculation.draft ?? {}
  return { schemaVersion: 1, rows: [{ id: 'r1', passes: [{ id: 'r1p1',
    tubeCount: draft.tubeCount?.normalized ?? null, direction: draft.refDirection?.normalized ?? null }] }],
    connection: 'series', order: ['r1p1'],
    source: [draft.tubeCount?.source, draft.refDirection?.source].filter(Boolean).join('；'), origin: 'legacy-projection' }
}

export function normalizeTopology(input, origin = 'agent') {
  object(input, ['schemaVersion', 'rows', 'connection', 'order', 'source', 'origin'])
  if (input.schemaVersion !== 1) throw new McheError('结构版本不支持')
  if (!Array.isArray(input.rows) || input.rows.length < 1 || input.rows.length > 5) throw new McheError('排数必须为 1～5')
  if (!['series', 'parallel'].includes(input.connection)) throw new McheError('连接方式必须为串联或排间并联')
  if (typeof input.source !== 'string' || input.source.length > 1200) throw new McheError('请提供结构来源（最多1200字）')
  const ids = new Set(), passIds = []
  function id(value) {
    text(value, 40)
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(value) || ids.has(value)) throw new McheError('排和流程标识必须唯一且仅包含字母、数字、下划线和连字符')
    ids.add(value); return value
  }
  const rows = input.rows.map(row => {
    object(row, ['id', 'passes'])
    const rowId = id(row.id)
    if (!Array.isArray(row.passes) || row.passes.length < 1 || row.passes.length > 6) throw new McheError('每排流程数必须为 1～6')
    let total = 0
    const passes = row.passes.map(pass => {
      object(pass, ['id', 'tubeCount', 'direction'])
      const passId = id(pass.id); passIds.push(passId)
      if (pass.tubeCount !== null && (!Number.isSafeInteger(pass.tubeCount) || pass.tubeCount < 1 || pass.tubeCount > 500)) throw new McheError('流程管数必须为正整数，待填用 null')
      if (pass.direction !== null && !['left', 'right'].includes(pass.direction)) throw new McheError('冷媒方向必须为 left/right，待填用 null')
      total += pass.tubeCount ?? 0
      return { id: passId, tubeCount: pass.tubeCount, direction: pass.direction }
    })
    if (total > 500) throw new McheError('每排合计最多 500 根管')
    return { id: rowId, passes }
  })
  const order = input.order
  if (!Array.isArray(order) || order.length !== passIds.length || new Set(order).size !== order.length || order.some(p => !passIds.includes(p))) throw new McheError('经过顺序必须完整包含每个流程一次，不能重复或遗漏')
  if (input.connection === 'parallel' && order.some((p, i) => p !== passIds[i])) throw new McheError('排间并联按各排内部流程顺序连接，不能自定义跨排支路')
  if (rows.some(r => r.passes.some(p => p.tubeCount !== null || p.direction !== null)) && !input.source.trim()) throw new McheError('已填结构须提供来源依据')
  return { schemaVersion: 1, rows, connection: input.connection, order: [...order], source: input.source.trim(), origin }
}

export function topologyLayout(topology) {
  let nextTube = 1
  const passes = [], rowCounts = [], blockers = []
  topology.rows.forEach((row, rowIndex) => {
    let total = 0, complete = true
    row.passes.forEach((pass, passIndex) => {
      const start = nextTube
      if (pass.tubeCount === null) { complete = false; blockers.push({ code: 'topology_missing', field: pass.id, message: `第${rowIndex + 1}排流程${passIndex + 1}管数待填` }) }
      if (pass.direction === null) blockers.push({ code: 'topology_missing', field: pass.id, message: `第${rowIndex + 1}排流程${passIndex + 1}方向待填` })
      total += pass.tubeCount ?? 0
      nextTube = nextTube === null || pass.tubeCount === null ? null : nextTube + pass.tubeCount
      passes.push({ ...pass, rowId: row.id, rowIndex, passIndex, node: passes.length + 1,
        startTube: nextTube === null ? null : start, endTube: nextTube === null ? null : nextTube - 1 })
    })
    rowCounts.push(complete ? total : null)
  })
  const nodes = new Map(passes.map(p => [p.id, p.node])), exit = passes.length + 1
  const chains = topology.connection === 'series' ? [topology.order] : topology.rows.map(r => r.passes.map(p => p.id))
  const connection = Array.from({ length: exit + 1 }, () => Array(exit + 1).fill(0)), edges = []
  for (const chain of chains) {
    const path = [0, ...chain.map(id => nodes.get(id)), exit]
    for (let i = 1; i < path.length; i++) { const a = path[i - 1], b = path[i]; connection[a][b] = 1; connection[b][a] = -1; edges.push([a, b]) }
  }
  return { passes, rowCounts, blockers, edges, connection,
    header: blockers.length ? null : passes.map(p => [p.startTube, p.endTube, p.direction === 'left' ? 1 : -1, p.rowIndex]) }
}

export function applyTopology(native, topology, layout = topologyLayout(topology)) {
  native.general[1] = topology.rows.length
  const uniform = layout.rowCounts.every(n => n === layout.rowCounts[0])
  native.general[9] = uniform ? 1 : 0
  const tube = native.tube.slice(0, 14)
  native.tube.fill(0)
  for (let row = 0; row < (uniform ? 1 : topology.rows.length); row++) {
    native.tube.splice(row * 14, 14, ...tube); native.tube[row * 14 + 1] = layout.rowCounts[row]
  }
  native.header = layout.header; native.connection = layout.connection
  return native
}
