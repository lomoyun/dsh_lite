import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { parseWorkbook } from '../../packages/dsh-excel-understanding/src/parser.js'
import { compileRefrigerants, refrigerantsCsv, refrigerantsJson } from './refrigerants.mjs'
const catalog = JSON.parse(await readFile(new URL('../../data/catalogs/refrigerants.json', import.meta.url), 'utf8'))
const bytes = await readFile(new URL('../../答复_/5-冷媒库.xlsx', import.meta.url))
const index = parseWorkbook({ name: '5-冷媒库.xlsx', bytes })
test('61项原编号、类别、浓度与基准独立保留，空浓度不补0/100', () => {
  assert.equal(61, catalog.count)
  assert.deepEqual({ refrigerant: 26, water: 1, eg: 19, pg: 15 }, catalog.categoryCounts)
  for (const n of ['R134a', 'CO2', 'WATER', 'PROPYLEN', 'R1234zez', 'R1234zee', 'R1233zde']) assert.equal(n, catalog.byName[n].name)
  assert.equal('volume', catalog.byName['EG30Vol.'].concentrationBasis)
  assert.equal('mass', catalog.byName['EG30Wt.'].concentrationBasis)
  for (const n of ['CO2', 'WATER', 'PROPYLEN']) assert.equal(null, catalog.byName[n].concentrationPercent)
  assert.equal(true, catalog.source.columns[4].hidden)
})
test('305数据格及10标题/表头格逐项一致，JSON与CSV可重建', async () => {
  assert.equal(catalog.source.sha256, createHash('sha256').update(bytes).digest('hex'))
  let count = 0
  const cells = [...Object.values(catalog.source.headers), ...Object.values(catalog.byName).flatMap(r => Object.values(r.evidence))]
  for (const { cell, ...data } of cells) {
    const { address, ...source } = index.sheets[0].cells[cell]
    assert.deepEqual(data, source, cell); count++
  }
  assert.equal(315, count)
  const rebuilt = compileRefrigerants({ index, source: { path: catalog.source.path, bytes: bytes.length, sha256: catalog.source.sha256 } })
  assert.equal(await readFile(new URL('../../data/catalogs/refrigerants.json', import.meta.url), 'utf8'), refrigerantsJson(rebuilt))
  const csv = await readFile(new URL('../../data/catalogs/refrigerants.csv', import.meta.url), 'utf8')
  assert.equal(csv, refrigerantsCsv(rebuilt))
  const csvIndex = parseWorkbook({ name: 'refrigerants.csv', bytes: Buffer.from(csv) })
  for (const r of Object.values(catalog.byName)) for (const [key, f] of Object.entries(catalog.fields)) assert.equal(r.evidence[key].display, csvIndex.sheets[0].cells[f.column + (r.sequence + 1)]?.display ?? '')
})
test('布局、重复标识、序号和浓度不一致均停止导入，不改写原表', () => {
  for (const change of [x => { x.sheets[0].name = 'other' }, x => { x.sheets[0].cells.C4.raw = 'R134a' },
    x => { x.sheets[0].cells.A4.raw = 99 }, x => { x.sheets[0].cells.E30.raw = 40 },
    x => { x.sheets[0].cells.E2.raw = '浓度' }, x => { x.sheets[0].complete = false }, x => { x.sheets.push(x.sheets[0]) }]) {
    const altered = structuredClone(index); change(altered)
    assert.throws(() => compileRefrigerants({ index: altered, source: catalog.source }))
  }
})
test('CLI可跨目录使用，支持序号与浓度基准，拒绝别名及无效筛选', () => {
  const cli = fileURLToPath(new URL('../../scripts/refrigerants.mjs', import.meta.url))
  const run = args => spawnSync(process.execPath, [cli, ...args], { cwd: tmpdir(), encoding: 'utf8', windowsHide: true })
  let result = run(['list', '--category', 'eg', '--concentration', '30', '--basis', 'mass'])
  assert.equal(0, result.status, result.stderr); assert.deepEqual(['EG30Wt.'], JSON.parse(result.stdout).items.map(r => r.name))
  result = run(['list', '--sequence', '26']); assert.equal('CO2', JSON.parse(result.stdout).items[0].name)
  assert.notEqual(0, run(['get', 'R744']).status)
  assert.notEqual(0, run(['list', '--concentration', '101']).status)
})
