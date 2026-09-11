import assert from 'node:assert/strict'
import { test } from 'node:test'
import XLSX from 'xlsx'
import { parseWorkbook } from '../src/parser.js'
import { cellsIn } from '../src/ranges.js'

export function fixtureBytes() {
  const book = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet([['客户输入', null, null], [], ['型号', '00123'], ['温度', 12.5, '℃'], ['流量', '1,25', 'kg/s']])
  sheet.B6 = { t: 'n', v: 25, f: 'B4*2', z: '0.000' }; sheet['!ref'] = 'A1:C6'
  sheet['!merges'] = [XLSX.utils.decode_range('A1:C1')]
  sheet.B4.c = [{ a: '客户', t: '入口值' }]
  sheet['!rows'] = [null, { hidden: true }]
  XLSX.utils.book_append_sheet(book, sheet, '冷凝器')
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['说明'], ['☑ 铜管'], ['未填写', null]]), '隐藏说明')
  book.Workbook = { Sheets: [{ Hidden: 0 }, { Hidden: 1 }] }
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' })
}
test('索引所有 Sheet，保留坐标、空白、合并、隐藏、公式缓存、单位和前导零', () => {
  const index = parseWorkbook({ name: '客户.xlsx', bytes: fixtureBytes() })
  assert.equal(2, index.sheets.length)
  const [sheet, hidden] = index.sheets
  assert.equal(1, hidden.hidden)
  assert.deepEqual(['A1:C1'], sheet.merges)
  assert.equal('00123', sheet.cells.B3.raw)
  assert.equal('1,25', sheet.cells.B5.raw)
  assert.equal('B4*2', sheet.cells.B6.formula)
  assert.equal(25, sheet.cells.B6.cached)
  assert.equal('25.000', sheet.cells.B6.display)
  assert.equal('入口值', sheet.cells.B4.comments[0].text)
  assert.equal(null, cellsIn(sheet, 'A2:C2')[0].raw)
  assert.equal('glyph', hidden.objects.find((item) => item.kind === 'checkbox').basis)
})
test('CSV 不假定表头，不转换小数逗号和前导零；XLS 可读但对象识别限制显式列出', () => {
  const csv = parseWorkbook({ name: '客户.csv', bytes: Buffer.from('型号;值\r\n00123;1,25\r\n;\r\n') })
  assert.equal('00123', csv.sheets[0].cells.A2.raw)
  assert.equal('1,25', csv.sheets[0].cells.B2.raw)
  const book = XLSX.read(fixtureBytes())
  const legacy = parseWorkbook({ name: '客户.xls', bytes: XLSX.write(book, { type: 'buffer', bookType: 'xls' }) })
  assert.equal(2, legacy.sheets.length)
  assert.ok(legacy.issues.some((item) => item.code === 'legacy_objects'))
})

test('公式缺少缓存时保持缺失，不能被解析库默认值冒充为零', () => {
  const zip = XLSX.CFB.read(fixtureBytes(), { type: 'buffer' })
  const part = zip.FileIndex[zip.FullPaths.findIndex((path) => path.endsWith('/xl/worksheets/sheet1.xml'))]
  const xml = Buffer.from(part.content).toString('utf8').replace(/(<c\b[^>]*r="B6"[^>]*>[\s\S]*?)<v>25<\/v>/, '$1')
  part.content = Buffer.from(xml); part.size = part.content.length
  const bytes = XLSX.CFB.write(zip, { type: 'buffer', fileType: 'zip' })
  const index = parseWorkbook({ name: '缺少缓存.xlsx', bytes })
  assert.equal('B4*2', index.sheets[0].cells.B6.formula)
  assert.equal(null, index.sheets[0].cells.B6.raw)
  assert.equal(null, index.sheets[0].cells.B6.cached)
})
