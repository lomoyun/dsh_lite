import assert from 'node:assert/strict'
import { test } from 'node:test'
import XLSX from 'xlsx'
import { normalizeTables, tableFromGrid, TABLE_LIMITS } from '../public/table-data.js'
import { parseDelimited, parsePastedTables } from '../public/table-format.js'
import { encodeChatInput, decodeChatInput, messageParts } from '../public/table-message.js'
import { parseWorkbook } from '../src/table-workbook.js'

test('CSV 保留中文、引号、换行、空值和前导零，拒绝未闭合引号', () => {
  const rows = parseDelimited('编号,备注,数值\r\n001,"两行\r\n说明",0\r\n002,"a,""b""",\r\n', ',')
  assert.deepEqual([['编号', '备注', '数值'], ['001', '两行\n说明', '0'], ['002', 'a,"b"', '']], rows)
  assert.throws(() => parseDelimited('a,b\n"missing,end', ','), /引号/)
})

test('粘贴支持 Excel TSV 与 Markdown，保留重复列和转义竖线', () => {
  const tsv = parsePastedTables('参数\t数值\t数值\n宽度\t16\t\n温度\t0\t27')
  assert.deepEqual(['参数', '数值', '数值'], tsv[0].columns)
  assert.deepEqual(['宽度', '16', ''], tsv[0].rows[0])
  const md = parsePastedTables('| 参数 | 值 |\n| :--- | ---: |\n| A\\|B | 0 |')
  assert.deepEqual([['A|B', '0']], md[0].rows)
  assert.deepEqual([], parsePastedTables('冷凝器宽度是16毫米，请帮我整理'))
})

test('结构校验限制尺寸，不截断额外列、不把空值补成零', () => {
  const table = tableFromGrid([['参数', '值'], ['温度'], ['宽度', '16', 'mm']])
  assert.deepEqual(['参数', '值', ''], table.columns)
  assert.deepEqual(['温度', '', ''], table.rows[0])
  assert.throws(() => normalizeTables([{ ...table, rows: [[Infinity]] }]), /文本|数值|格式/)
  assert.throws(() => tableFromGrid([Array(TABLE_LIMITS.columns + 1).fill('x')]), /列/)
  assert.throws(() => normalizeTables([{ columns: ['a'], rows: [['a', 'b']] }]), /列/)
})

test('表格消息往返保持字符原样，普通对话不改变，损坏输出不冒充表格', () => {
  const table = tableFromGrid([['编号', '备注'], ['001', 'a|b\n```\n<script>']], { title: '工况' })
  const encoded = encodeChatInput({ prompt: '请核对', intent: 'chat', tables: [table] })
  assert.deepEqual({ prompt: '请核对', intent: 'chat', tables: [table] }, decodeChatInput(encoded))
  assert.equal('你好', encodeChatInput({ prompt: '你好' }))
  assert.deepEqual([table], messageParts(encoded).filter((p) => p.type === 'table').map((p) => p.table))
  const reply = '已提取：\n```mche-table\n' + JSON.stringify(table) + '\n```'
  assert.deepEqual([table], messageParts(reply).filter((p) => p.type === 'table').map((p) => p.table))
  assert.equal(0, messageParts('```mche-table\n{"rows":"bad"}\n```').filter((p) => p.type === 'table').length)
})

test('Excel 支持 xlsx/xls、多工作表、显示格式及公式文本', () => {
  const book = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet([['编号', '值', '空列'], [1, 0, ''], ['说明', '中文', '']])
  sheet.A2.z = '0000'
  sheet.B4 = { t: 'n', f: 'SUM(B2:B3)', v: 0 }
  sheet['!ref'] = 'A1:C4'
  XLSX.utils.book_append_sheet(book, sheet, '工况')
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['参数', '值'], ['宽度', '16']]), '几何')
  for (const bookType of ['xlsx', 'xls']) {
    const result = parseWorkbook({ name: `输入.${bookType}`, bytes: XLSX.write(book, { type: 'buffer', bookType }) })
    assert.equal(2, result.tables.length)
    assert.deepEqual(['0001', '0', ''], result.tables[0].rows[0])
    // SheetJS 的旧版 XLS 写入器不生成公式记录，公式读取用 XLSX 样例验证。
    if (bookType === 'xlsx') {
      assert.equal('=SUM(B2:B3)', result.tables[0].rows[2][1])
      assert.match(result.tables[0].warnings.join(' '), /公式/)
    }
    assert.equal('几何', result.tables[1].title)
  }
})

test('导入拒绝伪造格式、空文件与过大工作表，CSV 无需模型', () => {
  assert.throws(() => parseWorkbook({ name: 'fake.xlsx', bytes: Buffer.from('a,b\n1,2') }), /格式|Excel/)
  assert.throws(() => parseWorkbook({ name: 'empty.csv', bytes: Buffer.alloc(0) }), /空/)
  const csv = parseWorkbook({ name: '工况.csv', bytes: Buffer.from('\ufeff参数,值\n宽度,16\n温度,0') })
  assert.deepEqual([['宽度', '16'], ['温度', '0']], csv.tables[0].rows)
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(Array.from({ length: TABLE_LIMITS.rows + 2 }, () => ['x'])), '过大')
  assert.throws(() => parseWorkbook({ name: 'large.xlsx', bytes: XLSX.write(book, { type: 'buffer' }) }), /行/)
})

test('CSV 编码与分隔符检测保留引号内的逗号和中文', () => {
  const semicolon = parseWorkbook({ name: '输入.csv', bytes: Buffer.from('"参数,说明";值\n宽度;16') })
  assert.deepEqual(['参数,说明', '值'], semicolon.tables[0].columns)
  const utf16 = parseWorkbook({ name: '输入.csv', bytes: Buffer.from('\ufeff参数,值\n宽度,16', 'utf16le') })
  assert.deepEqual([['宽度', '16']], utf16.tables[0].rows)
  const gbk = parseWorkbook({ name: '输入.csv', bytes: Buffer.from('b2cecafd2cd6b50abfedb6c82c3136', 'hex') })
  assert.deepEqual(['参数', '值'], gbk.tables[0].columns)
  assert.match(gbk.tables[0].warnings[0], /GB18030/)
})

test('超限模型表格保留原文，隐藏表和合并格有提示', () => {
  const block = '```mche-table\n{"columns":["a"],"rows":[["0"]]}\n```\n'
  const parts = messageParts(block.repeat(9))
  assert.equal(8, parts.filter((part) => part.type === 'table').length)
  assert.match(parts.at(-1).text, /mche-table/)
  const book = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet([['参数', '值'], ['说明', '']])
  sheet['!merges'] = [{ s: { r: 1, c: 0 }, e: { r: 1, c: 1 } }]
  XLSX.utils.book_append_sheet(book, sheet, '隐藏')
  book.Workbook = { Sheets: [{ name: '隐藏', Hidden: 1 }] }
  const table = parseWorkbook({ name: '输入.xlsx', bytes: XLSX.write(book, { type: 'buffer' }) }).tables[0]
  assert.deepEqual(['说明', ''], table.rows[0])
  assert.match(table.warnings.join(' '), /隐藏.*合并/)
})

test('附件发送后按实际 Excel 内容识别格式，扩展名不一致时提示', () => {
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['参数', '值'], ['宽度', '16']]), '工况')
  for (const bookType of ['xlsx', 'xls']) {
    const result = parseWorkbook({ name: '被改名.csv', bytes: XLSX.write(book, { type: 'buffer', bookType }) })
    assert.deepEqual([['宽度', '16']], result.tables[0].rows)
    assert.match(result.tables[0].warnings.join(' '), /实际内容识别/)
  }
})
