import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { compileFlatTubes, getFlatTube, listFlatTubes, numericValue, FLAT_TUBE_FIELDS } from './flat-tubes.mjs'
import { parseWorkbook } from '../../packages/dsh-excel-understanding/src/parser.js'

const workbook = new URL('../../答复_/1-扁管选型.xls', import.meta.url)
const realSource = { skip: !existsSync(workbook) }
const loadIndex = async () => parseWorkbook({ name: '1-扁管选型.xls', bytes: await readFile(workbook) })
const source = { path: 'fixture.xls', sha256: 'fixture-digest', bytes: 1 }
const require = createRequire(new URL('../../packages/dsh-excel-understanding/package.json', import.meta.url))
const XLSX = require('xlsx')

test('只转换确定的数值文本，复杂孔型、标记和空白保持未知', () => {
  assert.equal(0.7, numericValue('0.70'))
  assert.equal(null, numericValue('φ0.7'))
  assert.equal(null, numericValue('0.7/1.0'))
  assert.equal(null, numericValue('4.8.1'))
  assert.equal(null, numericValue('/'))
  assert.equal(null, numericValue('？'))
  assert.equal(null, numericValue(null))
  assert.equal(null, numericValue(''))
})

test('全部89型号保留名字、12个几何字段、原值、缓存公式和单元格来源', realSource, async () => {
  const catalog = compileFlatTubes({ index: await loadIndex(), source })
  assert.equal(89, catalog.count)
  assert.ok(catalog.byName.A010S); assert.ok(catalog.byName.A10)
  const a = getFlatTube(catalog, 'A01S').tube
  assert.equal(12, Object.keys(a.geometry).length)
  assert.equal(16, a.geometry.widthMm); assert.equal(10, a.geometry.portCount)
  assert.equal('B3', a.evidence.widthMm.cell)
  assert.equal(17.279291856, a.geometry.materialAreaMm2)
  assert.match(a.evidence.materialAreaMm2.formula, /B3-C3/)
  assert.equal('17.2793 ', a.evidence.materialAreaMm2.display)
  assert.equal(null, catalog.byName.A010S.geometry.portWidthMm)
  assert.equal('非均匀', catalog.byName.A010S.evidence.portWidthMm.raw)
  assert.equal('φ0.7', catalog.byName.A67S1.evidence.portWidthMm.raw)
  assert.equal('0.70', catalog.byName.A67S1.evidence.ribThicknessMm.raw)
  assert.equal(0.7, catalog.byName.A67S1.geometry.ribThicknessMm)
  assert.ok(catalog.byName.A192S1.review.some(item => item.code === 'wall_exceeds_height'))
  assert.ok(catalog.byName.A149S1.review.some(item => item.code === 'port_exceeds_height'))
})

test('拒绝重名、丢失名称或变化的表头，防止静默覆盖或错列', realSource, async () => {
  const index = await loadIndex(), sheet = index.sheets.find(item => item.name === '总表')
  sheet.cells.A4.raw = sheet.cells.A3.raw
  assert.throws(() => compileFlatTubes({ index, source }), /重复/)
  sheet.cells.A4.raw = null
  assert.throws(() => compileFlatTubes({ index, source }), /缺少模具号/)
  sheet.cells.B1.raw = '错误列'
  assert.throws(() => compileFlatTubes({ index, source }), /表头/)
})

test('精确名称查询与分页尺寸筛选；未知值和对象原型不是型号', async () => {
  const catalog = JSON.parse(await readFile(new URL('../../data/catalogs/flat-tubes.json', import.meta.url), 'utf8'))
  assert.throws(() => getFlatTube(catalog, '__proto__'), /不存在/)
  assert.throws(() => getFlatTube(catalog, 'a01s'), /不存在/)
  const first = listFlatTubes(catalog, { widthMm: 16, heightMm: 1.8, limit: 2 })
  assert.equal(2, first.items.length); assert.equal(2, first.nextOffset)
  assert.ok(first.items.every(tube => tube.geometry.widthMm === 16 && tube.geometry.heightMm === 1.8))
  const all = [], seen = new Set(); let offset = 0
  do {
    const page = listFlatTubes(catalog, { offset, limit: 20 })
    all.push(...page.items); offset = page.nextOffset
  } while (offset !== null)
  for (const tube of all) seen.add(tube.name)
  assert.equal(89, seen.size)
  assert.throws(() => listFlatTubes(catalog, { widthMm: '' }), /筛选/)
  assert.throws(() => listFlatTubes(catalog, { typo: 16 }), /筛选/)
})

test('已保存目录与原 XLS 全部1424格逐项对账，CSV保留显示文本且重建结果一致', realSource, async (t) => {
  const bytes = await readFile(workbook), catalog = JSON.parse(await readFile(new URL('../../data/catalogs/flat-tubes.json', import.meta.url), 'utf8'))
  const original = XLSX.read(bytes, { type: 'buffer', cellNF: true, cellText: true, sheetStubs: true }).Sheets['总表']
  const csv = XLSX.read(await readFile(new URL('../../data/catalogs/flat-tubes.csv', import.meta.url), 'utf8'), { type: 'string', raw: true }).Sheets.Sheet1
  assert.equal(createHash('sha256').update(bytes).digest('hex'), catalog.source.sha256)
  const names = []; let cells = 0
  for (let row = 3; row <= 91; row++) {
    const name = original[`A${row}`].v, tube = catalog.byName[name]; names.push(name)
    assert.ok(tube, `缺少 ${name}`)
    assert.equal(`A${row}:P${row}`, tube.sourceRange)
    for (const [key, field] of Object.entries(FLAT_TUBE_FIELDS)) {
      const address = field.column + row, cell = original[address], saved = tube.evidence[key]
      assert.equal(address, saved.cell)
      assert.deepEqual(cell?.v ?? null, saved.raw, `${name} ${address} 原值`)
      assert.equal(cell?.w ?? XLSX.utils.format_cell(cell), saved.display, `${name} ${address} 原文`)
      assert.equal(cell?.f ?? null, saved.formula, `${name} ${address} 公式`)
      assert.deepEqual(cell?.f ? cell.v ?? null : null, saved.cached, `${name} ${address} 缓存`)
      assert.equal(saved.display, csv[field.column + (row - 1)]?.v ?? '', `${name} CSV ${key}`)
      cells++
    }
  }
  assert.deepEqual(names, Object.keys(catalog.byName))
  const { path, sha256, bytes: size } = catalog.source
  const rebuilt = compileFlatTubes({ index: await loadIndex(), source: { path, sha256, bytes: size } })
  assert.equal(true, JSON.stringify(catalog) === JSON.stringify(rebuilt), '重建的 JSON 内容须与已保存目录完全一致')
  assert.equal(1424, cells)
  t.diagnostic(`${names.length} 个型号 / ${cells} 个来源单元格及 CSV 显示文本一致`)
})
