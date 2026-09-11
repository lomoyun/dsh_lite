import { join } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { WorkbookStore, digest } from './store.js'
import { LIMITS, VERSION, ExcelError, requireId } from './limits.js'
import { sheetOf, validRange } from './ranges.js'
import { validateUnderstanding } from './understanding.js'
import { renderPreview } from './preview.js'
import { overviewSheets } from './overview.js'
import { readPage } from './read-page.js'
import { recordRead, confirmedReads } from './read-coverage.js'

export class ExcelService {
  constructor({ root, ctx, parse, render = renderPreview }) {
    this.store = new WorkbookStore(root, parse); this.ctx = ctx; this.render = render; this.rendering = false
  }
  async import(input) { return { file: await this.store.create(input) } }
  async inspect({ fileId, sessionId, metadataOffset = 0 }) {
    const meta = await this.store.owned(fileId, sessionId)
    if (meta.status !== 'ready') return { file: meta, sheets: [], issues: [{ code: 'parse_failed', message: meta.error ?? '解析未完成' }] }
    const { index, state } = await this.store.load(fileId, sessionId)
    const legacy = state.reads.some((read) => !read.version)
    const issues = [...index.issues, ...(legacy ? [{ code: 'read_confirmation_required', message: '旧版读取可能经过宿主截断，不计入已确认范围；请重新按页读取。' }] : [])]
    return { schemaVersion: VERSION, file: meta, limits: LIMITS, issues, resultIds: state.results,
      sheets: overviewSheets(index, state, metadataOffset) }
  }
  async read(input, actor = 'model') {
    return this.store.update(input.fileId, input.sessionId, ({ index, state }) => {
      const result = readPage(input, sheetOf(index, input.sheet), state)
      if (actor === 'model') recordRead(state, result)
      return result
    })
  }
  async acknowledge(input) {
    const { state } = await this.store.load(input.fileId, input.sessionId)
    if (confirmedReads(state, input.sheet).some((read) => read.range === input.returnedRange)) return
    return this.store.update(input.fileId, input.sessionId, ({ index, state }) => {
      validRange(sheetOf(index, input.sheet), input.returnedRange)
      recordRead(state, input)
    })
  }
  async search(input) {
    const { index } = await this.store.load(input.fileId, input.sessionId)
    if (typeof input.query !== 'string' || !input.query || input.query.length > 200) throw new ExcelError('搜索文本应为 1–200 字')
    const offset = input.offset ?? 0
    if (!Number.isSafeInteger(offset) || offset < 0) throw new ExcelError('无效的搜索游标')
    const matches = [], query = input.query.toLocaleLowerCase()
    let position = 0, nextOffset = null
    for (const sheet of index.sheets) {
      for (const cell of Object.values(sheet.cells)) {
        if (position++ < offset) continue
        if (![cell.display, cell.raw, cell.formula, ...cell.comments.map((c) => c.text)].some((text) => String(text ?? '').toLocaleLowerCase().includes(query))) continue
        if (matches.length === LIMITS.searchResults) { nextOffset = position - 1; break }
        matches.push({ sheet: sheet.name, address: cell.address, display: cell.display.slice(0, 500), hidden: sheet.hidden })
      }
      if (nextOffset !== null) break
    }
    return { fileId: input.fileId, matches, nextOffset, issues: index.issues, instruction: '命中仅用于定位；发布前请按范围回查原文。' }
  }
  async preview(input, agent) {
    if (this.rendering) throw new ExcelError('正在生成其他预览，请稍后重试', 409)
    this.rendering = true
    try { return await this.store.update(input.fileId, input.sessionId, async (context) => {
      const sheet = sheetOf(context.index, input.sheet)
      if (input.range) validRange(sheet, input.range, Infinity)
      let preview = context.state.previews.find((p) => p.status === 'ready' && p.sheet === input.sheet && p.range === (input.range ?? null))
      if (!preview) {
        try { preview = await this.render({ directory: this.store.directory(input.fileId), meta: context.meta, sheet: input.sheet, range: input.range }) }
        catch (error) {
          const failure = { id: randomUUID(), status: 'unavailable', fileId: input.fileId, sheet: input.sheet,
            range: input.range ?? null, visualStatus: 'not_verified', message: error.message }
          context.state.previews.push(failure); return failure
        }
        context.state.previews.push(preview)
      }
      return this.deliverPreview(preview, input, agent)
    }) } finally { this.rendering = false }
  }
  async deliverPreview(preview, input, agent) {
    const info = agent && await this.ctx?.llm.resolveModelInfo(agent.options.provider, agent.options.model)
    const supportsImages = info?.inputModalities?.includes('image') === true
    let images = [], visualStatus = agent ? 'model_not_vision_capable' : 'browser_preview_only'
    if (supportsImages && this.ctx?.attachments) {
      const page = input.page ?? 1, entry = preview.pages.find((item) => item.page === page)
      if (!entry) throw new ExcelError('预览页码超出当前范围')
      const data = await this.artifact({ ...input, previewId: preview.id, artifact: entry.filename }, preview)
      images = [await this.ctx.attachments.saveImage({ data: data.bytes, mediaType: 'image/png', name: `excel-${preview.id}-${page}.png` })]
      preview.deliveredToModel = true
      preview.deliveredPages = [...new Set([...(preview.deliveredPages ?? []), page])]
      visualStatus = 'image_provided_for_verification'
    }
    return { ...preview, fileId: input.fileId, visualStatus, images,
      instruction: '预览可能重算或改变分页；原始值以 read_range 为准。图片已提供不等于已核验；视觉结论应作为观察发布。' }
  }
  async publish(input) {
    return this.store.update(input.fileId, input.sessionId, async (context) => {
      const result = validateUnderstanding(input.understanding, context)
      await writeFile(join(this.store.directory(input.fileId), `${result.resultId}.json`), JSON.stringify(result), { flag: 'wx' })
      context.state.results.push(result.resultId)
      return { schemaVersion: VERSION, fileId: input.fileId, resultId: result.resultId,
        overview: result.overview, validation: result.validation, instruction: '理解结果已保存，可在右侧查看。字段仍为候选，不是正式计算输入。' }
    })
  }
  async result({ fileId, sessionId, resultId }) {
    const { state } = await this.store.load(fileId, sessionId); requireId(resultId)
    if (!state.results.includes(resultId)) throw new ExcelError('理解结果不存在', 404)
    return JSON.parse(await readFile(join(this.store.directory(fileId), `${resultId}.json`), 'utf8'))
  }
  async artifact(input, existing) {
    const meta = await this.store.owned(input.fileId, input.sessionId), directory = this.store.directory(input.fileId)
    if (input.artifact === 'original') {
      const bytes = await readFile(join(directory, 'original'))
      if (digest(bytes) !== meta.sha256) throw new ExcelError('原文件摘要不一致')
      return { bytes, type: 'application/octet-stream', name: meta.name }
    }
    const { state } = existing ? { state: { previews: [existing] } } : await this.store.load(input.fileId, input.sessionId)
    const preview = state.previews.find((item) => item.id === input.previewId && item.status === 'ready')
    const page = preview?.pages.find((item) => item.filename === input.artifact)
    if (!preview || (!page && input.artifact !== 'preview.pdf')) throw new ExcelError('预览产物不存在', 404)
    const bytes = await readFile(join(directory, 'previews', preview.id, 'output', input.artifact))
    if (digest(bytes) !== (page?.sha256 ?? preview.pdfSha256)) throw new ExcelError('预览产物摘要不一致')
    return { bytes, type: page ? 'image/png' : 'application/pdf' }
  }
}
