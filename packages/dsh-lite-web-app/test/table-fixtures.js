import XLSX from 'xlsx'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { decodeChatInput } from '../public/table-message.js'
import { tableFromGrid } from '../public/table-data.js'

export function fixtureWorkbook() {
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ['参数', '数值', '单位'], ['扁管宽度', '16', 'mm'], ['开窗角度', '27', '°'], ['换热量', '', 'W'],
  ]), '输入工况')
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ['物料编号', '宽度', '说明'], ['0016', '16', '<script>不执行</script>'], ['0025', '25.4', ''],
  ]), '物料')
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' })
}

// 只用于本地接口与浏览器验收，固定样例不代表真实模型的提取能力。
export function lastUserText(body) {
  const userTexts = (body.messages ?? []).filter((message) => message.role === 'user').map(({ content }) =>
    typeof content === 'string' ? content : (content ?? []).filter((part) => part.type === 'text').map((part) => part.text).join(''))
  return userTexts.findLast((text) => !text.trim().startsWith('<system-reminder>') && !text.startsWith('Current runtime context.')) ?? ''
}

export function mockTableResponse(body) {
  const input = decodeChatInput(lastUserText(body))
  if (input?.intent !== 'extract') return null
  const table = input.tables[0] ?? tableFromGrid([
    ['参数', '数值', '单位', '来源原文'], ['扁管宽度', '16', 'mm', '扁管宽度16mm'],
    ['开窗角度', '27', '°', '开窗角度27度'], ['换热量', '', 'W', '换热量未提供'],
  ], { title: '微通道参数' })
  return `已将提供的信息整理为表格，请核对后确认。\n\n\`\`\`mche-table\n${JSON.stringify(table)}\n\`\`\``
}

export async function writeTableFixtures(directory) {
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'sample.xlsx'), fixtureWorkbook())
  await writeFile(join(directory, 'sample.csv'), '\ufeff参数,数值,单位\r\n扁管宽度,16,mm\r\n开窗角度,27,°\r\n换热量,,W\r\n')
}
