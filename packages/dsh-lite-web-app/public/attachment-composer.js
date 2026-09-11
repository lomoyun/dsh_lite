import { AttachmentQueue } from './attachment-queue.js'
import { mountAttachmentDrop } from './attachment-drop.js'

const $ = (selector) => document.querySelector(selector)
const STATUS_TEXT = { pending: '待发送', uploading: '正在上传并解析…', ready: '已解析，等待发送', error: '上传失败', saved: '原件已保存，解析未完成' }
const KIB = 1024
const sizeLabel = (size) => size < KIB * KIB ? `${Math.max(1, Math.ceil(size / KIB))} KB` : `${(size / KIB / KIB).toFixed(1)} MB`
const node = (tag, text, className) => {
  const element = document.createElement(tag)
  element.textContent = text; element.className = className
  return element
}

export function mountAttachments(options) { return new AttachmentComposer(options) }

class AttachmentComposer {
  constructor({ onError, onChange }) {
    this.onError = onError; this.busy = false; this.readOnly = false
    this.dialog = $('#attachment-dialog')
    this.input = $('#attachment-file')
    this.queue = new AttachmentQueue({ deduplicate: false, onChange: () => { this.render(); onChange() } })
    this.bindDialog()
    mountAttachmentDrop({ root: $('main'), dialog: this.dialog, isLocked: () => this.busy || this.readOnly,
      onFiles: (files) => this.add(files), onError, showDrop: (value) => this.showDrop(value) })
    this.render()
  }
  bindDialog() {
    $('#attach-button').addEventListener('click', () => this.open())
    $('#welcome-attachment').addEventListener('click', () => this.open())
    $('#attachment-close').addEventListener('click', () => this.dialog.close())
    $('#attachment-choose').addEventListener('click', () => this.input.click())
    this.input.addEventListener('change', () => {
      this.add(Array.from(this.input.files)); this.input.value = ''
    })
    this.dialog.addEventListener('close', () => { this.showDrop(false); $('#prompt').focus() })
  }
  open() {
    if (this.busy || this.readOnly) return
    $('#attachment-error').textContent = ''
    if (!this.dialog.open) this.dialog.showModal()
  }
  add(files) {
    if (this.busy || this.readOnly || !files.length) return
    try {
      const count = this.queue.add(files)
      if (this.dialog.open) this.dialog.close()
      $('#attachment-status').textContent = count ? '附件已就绪，点击发送后上传并自动解析。' : '附件已在待发送列表中。'
      $('#prompt').focus()
    } catch (error) {
      $('#attachment-error').textContent = error.message; this.onError(error.message)
    }
  }
  render() {
    const entries = this.queue.list()
    $('#attachment-list').replaceChildren(...entries.map((entry) => this.card(entry)))
    $('#attachment-tray').hidden = !entries.length
    $('#attachment-status').textContent = this.busy ? '正在处理本轮附件…' : '附件已保留，可移除或点击发送继续。'
  }
  card(entry) {
    const item = node('li', '', `attachment-card attachment-${entry.status}`)
    const icon = node('span', entry.name.split('.').at(-1).toUpperCase(), 'attachment-type')
    icon.setAttribute('aria-hidden', 'true')
    const content = node('div', '', 'attachment-info')
    content.append(node('strong', entry.name, 'attachment-name'),
      node('span', `${sizeLabel(entry.size)} · ${STATUS_TEXT[entry.status]}`, 'attachment-meta'))
    if (entry.error) content.append(node('span', entry.error, 'attachment-error'))
    const remove = node('button', '×', 'attachment-remove')
    remove.type = 'button'; remove.disabled = this.busy; remove.setAttribute('aria-label', `移除附件 ${entry.name}`)
    remove.addEventListener('click', async () => {
      try { await this.queue.remove(entry.id); $('#attach-button').focus() } catch (error) { this.onError(error.message) }
    })
    item.append(icon, content, remove)
    return item
  }
  showDrop(value) {
    $('#attachment-drop-overlay').hidden = !value || this.dialog.open
    $('#attachment-choose').classList.toggle('is-dragging', value)
  }
  hasFiles() { return this.queue.hasFiles() }
  collect(tables) { return this.queue.collect(tables) }
  collectWorkbooks(context) { return this.queue.collectWorkbooks(context) }
  clear() { this.queue.clear() }
  setBusy(value, readOnly = false) {
    this.busy = value; this.readOnly = readOnly
    for (const id of ['attach-button', 'welcome-attachment', 'attachment-file', 'attachment-choose']) $( `#${id}`).disabled = value || readOnly
    for (const button of document.querySelectorAll('.attachment-remove')) button.disabled = value
    if (value) { this.showDrop(false); if (this.dialog.open) this.dialog.close() }
    this.render()
  }
}
