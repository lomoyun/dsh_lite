export function topology(rows = [[12, 8]], connection = 'series', order) {
  const records = rows.map((counts, i) => ({ id: `r${i+1}`, passes: counts.map((tubeCount, j) => ({ id: `r${i+1}p${j+1}`, tubeCount, direction: j % 2 ? 'right' : 'left' })) }))
  return { schemaVersion: 1, rows: records, connection, order: order ?? records.flatMap(r=>r.passes.map(p=>p.id)), source: '合成拓扑验收夹具，不是用户工程确认' }
}
export const fakeProcess = { async probe() { return { ready: true, fixture: true } }, start() {
  return { promise: Promise.resolve({ status: 'failed', error: 'deterministic fixture; no DLL call' }), cancel() {} }
} }
