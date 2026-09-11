import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { compileFins, getFin, listFins, finsJson, finsCsv } from './fins.mjs'
import { parseWorkbook } from '../../packages/dsh-excel-understanding/src/parser.js'

const workbook = new URL('../../答复_/2-翅片选型.xls', import.meta.url)
const realSource = { skip: !existsSync(workbook) }
const loadIndex = async () => parseWorkbook({ name: '2-翅片选型.xls', bytes: await readFile(workbook) })
const catalog = JSON.parse(await readFile(new URL('../../data/catalogs/fins.json', import.meta.url), 'utf8'))
const require = createRequire(new URL('../../packages/dsh-excel-understanding/package.json', import.meta.url))
const XLSX = require('xlsx')

test('保留164型号和四分区；穿管及横插几何不会套用主表列含义', () => {
  assert.equal(catalog.count, 164)
  assert.deepEqual(catalog.sectionCounts, { main: 135, tube_insert: 19, dongsheng: 4, cross_insert: 6 })
  const b = getFin(catalog, 'B01').fin
  assert.equal(b.code, '310010')
  assert.deepEqual([b.geometry.thicknessMm, b.geometry.widthMm, b.geometry.heightPreBrazingMm, b.geometry.heightPostBrazingMm, b.geometry.finPitchMm], [0.1, 16, 8.13, 8.1, 1.4])
  const tube = getFin(catalog, 'B150L').fin
  assert.equal(tube.geometry.stockWidthMm, 21)
  assert.equal(tube.geometry.slotLengthMm, 10.1)
  assert.equal(tube.unclassified.sourceColumnJ, 2.1)
  assert.equal(tube.unclassified.sourceColumnK, 7.6)
  assert.equal(tube.unclassified.sourceColumnM, 1.16)
  assert.equal(Object.hasOwn(tube.geometry, 'louverPitchMm'), false)
  assert.equal(Object.hasOwn(tube.geometry, 'heightPreBrazingMm'), false)
  const cross = getFin(catalog, 'B139').fin
  assert.equal(cross.geometry.slotPitchMm, 8)
  assert.equal(cross.geometry.slotWidthMm, 2)
  assert.equal(cross.geometry.slotLengthMm, 25.4)
  assert.equal(Object.hasOwn(cross.geometry, 'louverPitchMm'), false)
  assert.equal(Object.hasOwn(cross.geometry, 'heightPreBrazingMm'), false)
})

test('保留编号大小写、Code共享与缺失、编码范围和原说明', () => {
  assert.ok(catalog.byName.B0a)
  assert.throws(() => getFin(catalog, 'B0A'), /不存在/)
  assert.throws(() => getFin(catalog, '__proto__'), /不存在/)
  assert.equal(catalog.sharedCodeCount, 4)
  assert.equal(catalog.missingCodeCount, 17)
  assert.deepEqual(catalog.byCode['310150'], ['B0f', 'B150'])
  assert.deepEqual(listFins(catalog, { code: '310150' }).items.map(f => f.name), ['B0f', 'B150'])
  assert.equal(catalog.byName.B136.code, null)
  assert.equal(catalog.byName.B136.evidence.code.raw, '无图纸')
  assert.equal(catalog.byName.B423.code, '390065-66')
  assert.equal(listFins(catalog, { code: '390065' }).total, 0)
  assert.equal(listFins(catalog, { code: '390065-66' }).items[0].name, 'B423')
})

test('复合尺寸、公式缓存、原始零值、尺寸矛盾与使用限制均不丢失', () => {
  const fins = catalog.byName
  for (const [name, key, raw] of [['B704', 'thicknessMm', '0.08/0.09'], ['B3q', 'louverPitchMm', '变'],
    ['B3t', 'louverAngleDeg', '变'], ['B603', 'brazingChangeMm', '（0.04,0.02）'],
    ['B62', 'louverLengthOverallMm', '7.2(实际7)'], ['B01', 'rMm', '≤0.45'],
    ['B151', 'finPitchRangeMm', '1.7~2.1/2.6~3.0']]) {
    assert.equal(fins[name].geometry[key], null)
    assert.equal(fins[name].evidence[key].raw, raw)
    assert.ok(fins[name].review.some(r => r.field === key))
  }
  assert.equal(fins.B01.evidence.brazingChangeMm.formula, 'E6-G6')
  assert.equal(fins.B01.evidence.brazingChangeMm.cached, 0.030000000000001137)
  assert.equal(fins.B0f.geometry.brazingChangeMm, 0)
  assert.equal(fins.B184.geometry.louverAngleDeg, 0)
  assert.equal(fins.B184.geometry.louverCount, 0)
  assert.ok(!fins.B184.review.some(r => r.code === 'invalid_geometry_number'))
  assert.ok(fins.B184.review.some(r => r.code === 'pitch_outside_sample_range'))
  assert.equal(fins.B421.geometry.rMm, 45)
  assert.ok(fins.B421.review.some(r => r.code === 'r_exceeds_dimensions'))
  for (const name of ['B421', 'B604', 'B605', 'B208']) assert.ok(fins[name].review.some(r => r.code === 'brazing_change_mismatch'))
  assert.ok(fins.B0k.review.some(r => r.code === 'section_restriction'))
  assert.ok(fins.B34.review.some(r => r.code === 'source_restriction'))
  assert.ok(fins.B71D.review.some(r => r.code === 'source_restriction'))
  assert.ok(Object.values(fins).every(f => !f.calculationReady && f.availability === 'not_verified'))
})

test('按明确几何字段精确筛选，分页完整，拒绝错误筛选和模糊高度', () => {
  const main = listFins(catalog, { widthMm: 16, heightPostBrazingMm: 8.1, finPitchMm: 1.4 })
  assert.ok(main.items.some(f => f.name === 'B01'))
  assert.ok(main.items.every(f => f.geometry.widthMm === 16 && f.geometry.finPitchMm === 1.4))
  assert.equal(main.items.find(f => f.name === 'B01').geometryText.rMm, '≤0.45')
  assert.equal(listFins(catalog, { section: 'cross_insert', slotPitchMm: 8, slotLengthMm: 25.4 }).items[0].name, 'B139')
  assert.equal(listFins(catalog, { section: 'tube_insert', widthMm: 21 }).total, 0)
  assert.ok(listFins(catalog, { section: 'tube_insert', stockWidthMm: 21 }).total > 0)
  const names = []; let offset = 0
  do { const page = listFins(catalog, { offset, limit: 17 }); names.push(...page.items.map(f => f.name)); offset = page.nextOffset } while (offset !== null)
  assert.deepEqual(names, Object.keys(catalog.byName))
  for (const input of [{ heightMm: 8.1 }, { widthMm: '' }, { code: 310150 }, { section: 'wrong' }, { limit: 0 },
    { offset: -1 }, { limit: 101 }, { offset: 0.5 }, { finPitchMm: NaN }, { louverCount: 1.5 }, { finPitchRangeMm: 1.4 }]) {
    assert.throws(() => listFins(catalog, input))
  }
})

test('来源变化时拒绝漏行、重复型号、意外Sheet、错列、错误单位或分区', realSource, async () => {
  const original = await loadIndex()
  const cases = [s => { s.cells.A7.raw = 'B01' }, s => { s.cells.A7.raw = null },
    s => { s.cells.L142.raw = 'Louver Length (Overall)' }, s => { s.cells.E168.raw = 'Fin Height' },
    s => { s.cells.C4.raw = 'cm' }, s => { s.cells.J142.raw = 'R' },
    s => { s.cells.A162.raw = '新的分区' }, s => { s.complete = false }, s => { s.range = 'A1:AA175' },
    s => { s.merges.push('A6:A7') }]
  for (const mutate of cases) {
    const index = structuredClone(original); mutate(index.sheets[0])
    assert.throws(() => compileFins({ index, source: catalog.source }))
  }
  original.sheets.push({ name: 'Other' })
  assert.throws(() => compileFins({ index: original, source: catalog.source }), /Sheet/)
})

test('原XLS全部4698格与已保存目录及CSV逐项对账，公式不重算且重建完全一致', realSource, async t => {
  const bytes = await readFile(workbook)
  const book = XLSX.read(bytes, { type: 'buffer', cellNF: true, cellText: true, cellStyles: true, sheetStubs: true })
  assert.deepEqual(book.SheetNames, ['Fin'])
  const original = book.Sheets.Fin, visited = new Set()
  assert.equal(catalog.source.sha256, createHash('sha256').update(bytes).digest('hex'))
  assert.equal(catalog.source.bytes, bytes.length)
  const csvText = await readFile(new URL('../../data/catalogs/fins.csv', import.meta.url), 'utf8')
  const csv = XLSX.utils.sheet_to_json(XLSX.read(csvText, { type: 'string', raw: true }).Sheets.Sheet1, { header: 1, defval: '' })
  const csvFields = new Map(csv[0].map((label, i) => [label.split(' / ')[0], i]))
  let formulaCount = 0, row = 1, dataCells = 0
  const compare = saved => {
    const cell = original[saved.cell]
    assert.ok(!visited.has(saved.cell), `重复收录来源 ${saved.cell}`)
    visited.add(saved.cell)
    assert.deepEqual(saved.raw, cell?.v ?? null, `${saved.cell} 原值`)
    assert.equal(saved.display, cell?.w ?? XLSX.utils.format_cell(cell), `${saved.cell} 显示值`)
    assert.equal(saved.formula, cell?.f ?? null, `${saved.cell} 公式`)
    assert.deepEqual(saved.cached, cell?.f ? cell.v ?? null : null, `${saved.cell} 缓存`)
    assert.equal(saved.type, cell?.t ?? 'z', `${saved.cell} 类型`)
    assert.equal(saved.format, cell?.z ?? null, `${saved.cell} 格式`)
    assert.deepEqual(saved.comments, (cell?.c ?? []).map(c => ({ author: c.a ?? '', text: c.t ?? '' })))
    assert.equal(saved.hyperlink, cell?.l?.Target ?? null)
    if (saved.formula) formulaCount++
  }
  for (const fin of Object.values(catalog.byName)) {
    const section = catalog.sections[fin.section]
    assert.equal(csv[row][0], section.label)
    assert.equal(original[fin.evidence.name.cell].v, fin.name)
    assert.equal(Object.keys(fin.evidence).length, 27)
    for (const [key, saved] of Object.entries(fin.evidence)) {
      compare(saved); dataCells++
      assert.equal(csv[row][csvFields.get(key)], saved.display, `${fin.name} CSV ${key}`)
    }
    assert.equal(csv[row][csv[0].indexOf('来源区域')], `Fin!${fin.sourceRange}`)
    row++
  }
  for (const cells of Object.values(catalog.source.headers)) for (const saved of Object.values(cells)) compare(saved)
  assert.equal(dataCells, 4428)
  assert.equal(visited.size, 4698)
  const sourceAddresses = Object.keys(original).filter(a => /^[A-Z]+\d+$/.test(a))
  assert.ok(sourceAddresses.every(a => visited.has(a)), '所有原单元格必须被保存')
  assert.equal(csv.length, 165)
  const { path, sha256, bytes: size } = catalog.source
  const rebuilt = compileFins({ index: await loadIndex(), source: { path, sha256, bytes: size } })
  assert.deepEqual(JSON.parse(finsJson(rebuilt)), catalog)
  assert.equal(finsJson(rebuilt), await readFile(new URL('../../data/catalogs/fins.json', import.meta.url), 'utf8'))
  assert.equal(finsCsv(rebuilt), csvText)
  t.diagnostic(`${catalog.count} 型号 / ${dataCells} 数据格 + ${visited.size - dataCells} 表头格 / ${formulaCount} 条公式缓存 / CSV显示文本一致`)
})

test('CLI支持其他工作目录、按编号和尺寸查询，并对无效查询返回非零状态', () => {
  const script = fileURLToPath(new URL('../../scripts/fins.mjs', import.meta.url))
  const run = args => spawnSync(process.execPath, [script, ...args], { cwd: fileURLToPath(new URL('../../src', import.meta.url)), encoding: 'utf8' })
  let result = run(['get', 'B01'])
  assert.equal(result.status, 0, result.stderr)
  assert.equal(JSON.parse(result.stdout).fin.geometry.widthMm, 16)
  result = run(['list', '--code', '310150'])
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout).items.map(f => f.name), ['B0f', 'B150'])
  result = run(['list', '--section', 'cross_insert', '--slot-pitch', '8'])
  assert.equal(result.status, 0, result.stderr)
  assert.equal(JSON.parse(result.stdout).items[0].name, 'B139')
  assert.equal(run(['get', 'missing']).status, 1)
  assert.equal(run(['list', '--height', '8']).status, 1)
  assert.equal(run(['list', '--width', 'bad']).status, 1)
})
