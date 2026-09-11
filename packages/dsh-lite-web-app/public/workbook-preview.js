let pdfLibrary
const node = (tag, text = '') => { const el = document.createElement(tag); el.textContent = text; return el }
function highlightRegion(highlight, region) {
  highlight.hidden = !region
  if (!region) return
  const [left, top, right, bottom] = region
  Object.assign(highlight.style, { left: `${left * 100}%`, top: `${top * 100}%`, width: `${(right - left) * 100}%`, height: `${(bottom - top) * 100}%` })
}
export function createPreviewView({ sheets, preview, artifact, focus }) {
  const root = node('section'), controls = node('div'), sheet = node('select'), range = node('input'), show = node('button', '生成 / 查看预览')
  const status = node('p'), pages = node('div'), canvas = node('canvas'), download = node('a', '下载 PDF 预览')
  const layout = node('div'), highlight = node('div'); layout.className = 'workbook-preview-layout'; highlight.className = 'workbook-preview-highlight'
  highlight.hidden = true; highlight.setAttribute('aria-label', '引用的图片区域'); layout.append(canvas, highlight)
  sheet.setAttribute('aria-label', '预览 Sheet'); range.setAttribute('aria-label', '预览范围（可选）'); range.placeholder = '可选，例如 A1:H30'
  canvas.setAttribute('aria-label', '工作簿原始布局预览'); canvas.setAttribute('role', 'img'); canvas.className = 'workbook-preview'
  status.setAttribute('role', 'status'); show.type = 'button'; download.hidden = true
  for (const item of sheets) sheet.add(new Option(`${item.name}${item.hidden ? '（隐藏）' : ''}`, item.name))
  if (focus?.sheet) sheet.value = focus.sheet
  range.value = focus?.range ?? ''
  let document, current = 1, rendering
  async function render() {
    if (rendering) { rendering.cancel(); await rendering.promise.catch(() => {}) }
    const page = await document.getPage(current), viewport = page.getViewport({ scale: 1.25 })
    canvas.height = viewport.height; canvas.width = viewport.width
    rendering = page.render({ canvasContext: canvas.getContext('2d'), viewport })
    await rendering.promise
    highlightRegion(highlight, current === focus?.page && sheet.value === focus?.sheet ? focus?.region : null)
    status.textContent = `第 ${current} / ${document.numPages} 页 · 预览可能重算或改变分页；原始值以 Sheet 内容为准。`
  }
  show.addEventListener('click', async () => {
    show.disabled = true; status.textContent = '正在生成布局预览…'; download.hidden = true
    try {
      const result = await preview({ sheet: sheet.value, ...(range.value.trim() ? { range: range.value.trim().toUpperCase() } : {}) })
      if (result.status !== 'ready') { status.textContent = result.message; return }
      pdfLibrary ??= await import('/api/excel/pdf.mjs')
      pdfLibrary.GlobalWorkerOptions.workerSrc = '/api/excel/pdf.worker.mjs'
      const url = artifact({ previewId: result.id, artifact: 'preview.pdf' })
      await document?.destroy()
      document = await pdfLibrary.getDocument({ url, isEvalSupported: false, useWasm: false, useSystemFonts: true }).promise
      current = Math.min(document.numPages, focus?.page ?? 1); download.href = url; download.hidden = false; await render()
      if (result.limited) status.textContent += ' 已达到预览页数上限，其余内容未预览。'
    } catch (error) { status.textContent = `预览不可用：${error.message}` }
    finally { show.disabled = false }
  })
  for (const [label, offset] of [['上一页', -1], ['下一页', 1]]) {
    const button = node('button', label); button.type = 'button'
    button.addEventListener('click', async () => {
      if (!document) return
      current = Math.max(1, Math.min(document.numPages, current + offset))
      try { await render() } catch (error) { if (error.name !== 'RenderingCancelledException') status.textContent = error.message }
    }); pages.append(button)
  }
  controls.className = pages.className = 'workbook-controls'; controls.append(sheet, range, show)
  root.append(controls, status, pages, download, layout)
  if (focus?.previewId) queueMicrotask(() => show.click())
  root.addEventListener('dispose', () => { rendering?.cancel(); void document?.destroy() })
  return root
}
