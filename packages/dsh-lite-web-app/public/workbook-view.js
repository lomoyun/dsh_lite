import { createCellView } from './workbook-cells.js'
import { createPreviewView } from './workbook-preview.js'

const node = (tag, text = '') => { const el = document.createElement(tag); el.textContent = text; return el }
const conversionNames = { identity: '保留原值', trim: '去除两端空白', number: '文本转数值', decimal_comma: '小数逗号转数值' }
const objectNames = { image: '图片', drawing: '绘图', checkbox: '勾选信息', legacy_drawing: '旧式绘图或批注', control: '控件', external_link: '外部链接' }
async function post(action, input) {
  const response = await fetch(`/api/excel/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
  const value = await response.json(); if (!response.ok) throw new Error(value.error); return value
}
export function createWorkbookView({ file, session }) {
  const root = node('section'), status = node('p'), tabs = node('nav'), content = node('section'), footer = node('div')
  root.className = 'workbook-detail'; status.setAttribute('role', 'status'); tabs.setAttribute('aria-label', '工作簿详情分类')
  tabs.className = 'workbook-tabs'; footer.className = 'workbook-controls'
  let inspection, result, active = file.view === 'cells' ? 'Sheet 内容' : file.view === 'preview' ? '原始预览' : '概览', focus = file, loading = false
  const clear = () => { content.firstElementChild?.dispatchEvent(new Event('dispose')); content.replaceChildren() }
  root.addEventListener('dispose', clear)
  const identity = () => ({ fileId: file.fileId, sessionId: file.sessionId ?? session() })
  const artifact = (extra) => '/api/excel/artifact?' + new URLSearchParams({ ...identity(), ...extra })
  const request = (action, extra = {}) => post(action, { ...identity(), ...extra })
  function show(name, source) {
    active = name; focus = source
    for (const button of tabs.children) button.setAttribute('aria-pressed', String(button.textContent === name))
    clear()
    if (!inspection) return
    if (name === 'Sheet 内容') content.append(createCellView({ sheets: inspection.sheets, read: (input) => request('read', input), focus }))
    else if (name === '原始预览') {
      const saved = inspection.sheets.flatMap((sheet) => sheet.previews).find((preview) => preview.id === focus?.previewId)
      content.append(createPreviewView({ sheets: inspection.sheets, preview: (input) => request('preview', input), artifact,
        focus: saved ? { ...focus, range: saved.range } : focus }))
    }
    else if (name === '待核对项') renderIssues(content, inspection, result)
    else renderOverview(content, { inspection, result, show, matches: file.matches })
  }
  for (const name of ['概览', 'Sheet 内容', '原始预览', '待核对项']) {
    const button = node('button', name); button.type = 'button'; button.addEventListener('click', () => show(name)); tabs.append(button)
  }
  const original = node('a', '下载原文件'); original.href = artifact({ artifact: 'original' })
  const remove = node('button', '删除附件及关联资料'); remove.type = 'button'
  remove.addEventListener('click', async () => {
    remove.disabled = true
    try { await request('delete'); inspection = null; result = null; clear(); tabs.hidden = footer.hidden = true; status.textContent = '附件及关联资料已删除。历史引用保留，无法再回查原件。' }
    catch (error) { status.textContent = error.message; remove.disabled = false }
  })
  footer.append(original, remove); root.append(status, tabs, content, footer)
  root.addEventListener('detail-open', async () => {
    if (loading) return
    loading = true; status.textContent = '正在读取工作簿资料…'
    try {
      inspection = await request('inspect')
      const resultId = file.resultId ?? inspection.resultIds?.at(-1)
      result = resultId ? await request('result', { resultId }) : null
      status.textContent = `${inspection.file.name} · ${inspection.sheets.length} 个 Sheet`
      tabs.hidden = footer.hidden = false; show(active, focus)
    } catch (error) { inspection = null; clear(); tabs.hidden = footer.hidden = true; status.textContent = error.message }
    finally { loading = false }
  })
  return root
}
function renderOverview(root, { inspection, result, show, matches }) {
  root.append(node('p', result?.overview ?? '原文件已保存。尚未发布理解结果，可继续让 Agent 读取、回查和整理。'))
  if (inspection.file.error) root.append(node('p', `结构解析失败：${inspection.file.error}`))
  const list = node('ul')
  for (const sheet of inspection.sheets) {
    if (sheet.nextMetadataOffset != null) root.append(node('p', `${sheet.name}：还有未展示的对象、合并或隐藏行列元数据，可让 Agent 继续按页查阅。`))
    const coverage = result?.coverage.find((item) => item.sheet === sheet.name)
    list.append(node('li', `${sheet.name}${sheet.hidden ? '（隐藏）' : ''} · ${sheet.range ?? '空 Sheet'} · 索引${sheet.complete ? '完整' : '部分'}\n已读：${sheet.readRanges.join('、') || '未读取'}\n已理解：${coverage?.understoodRanges.join('、') || '未声明'}\n${coverage?.purpose || ''}`))
  }
  root.append(list)
  for (const match of matches ?? []) {
    const button = node('button', `${match.sheet}!${match.address}：${match.display}`); button.type = 'button'; button.className = 'detail-link'
    button.addEventListener('click', () => show('Sheet 内容', { sheet: match.sheet, range: match.address })); root.append(button)
  }
  if (!result) return
  root.append(node('p', '以下为理解候选；原始值与引用已校验，语义解释和单位仍需核对。'))
  for (const field of result.fields) {
    const section = node('section'); section.className = 'workbook-field'
    section.append(node('h3', field.label), node('p', `原始值：${JSON.stringify(field.raw)}${field.unit ? ` · 单位候选：${field.unit}` : ''}`))
    if (field.normalized) section.append(node('p', `规范化候选：${JSON.stringify(field.normalized.value)} · ${conversionNames[field.normalized.kind] ?? '待核对转换'}`))
    if (field.explanation) section.append(node('p', field.explanation))
    for (const source of field.evidence) {
      const button = node('button', `来源：${source.sheet}!${source.range ?? '图片区域'}`); button.type = 'button'; button.className = 'detail-link'
      button.addEventListener('click', () => show(source.range ? 'Sheet 内容' : '原始预览', source)); section.append(button)
    }
    root.append(section)
  }
  for (const observation of result.observations ?? []) {
    root.append(node('p', `视觉观察（模型判断）：${observation.observation ?? observation.quote}`))
    const button = node('button', `查看观察来源：${observation.sheet} 第 ${observation.page} 页`)
    button.type = 'button'; button.className = 'detail-link'
    button.addEventListener('click', () => show('原始预览', observation)); root.append(button)
  }
}
function renderIssues(root, inspection, result) {
  const issues = [...inspection.issues.map((issue) => issue.message), ...(result?.issues ?? []).map((issue) => issue.message)]
  for (const sheet of inspection.sheets) {
    if (!result) for (const object of sheet.objects) issues.push(`${sheet.name} · ${object.anchor ?? '位置未确认'} · ${objectNames[object.kind] ?? '扩展对象'}（需核对）`)
    if (!sheet.readRanges.length) issues.push(`${sheet.name}：尚未读取。`)
  }
  if (!result) issues.push('尚未发布理解结果；未完成视觉核验。')
  const list = node('ul'); for (const message of [...new Set(issues)]) list.append(node('li', message)); root.append(list)
}
