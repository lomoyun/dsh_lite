import { createTableCard } from './table-view.js'
import { messageParts } from './table-message.js'
import { parsePastedTables } from './table-format.js'
import { normalizeTables } from './table-data.js'
import { codeParts } from './detail-drawer.js'

export function createTableConversation({ messages, onSend, onError, onChange, details }) {
  const cards = new Set(), drafts = new Set()
  let busy = false, readOnly = false
  function cardFor(table, options = {}) {
    const card = createTableCard(table, { onChange, ...options })
    cards.add(card); card.setBusy(busy, readOnly)
    return card
  }
  const render = (body, text, role) => renderMessage({ body, text, role, cardFor, onSend, details })
  function addDrafts(tables) {
    const clean = normalizeTables(tables)
    normalizeTables([...drafts].flatMap((draft) => draft.entries.map((card) => card.getTable())).concat(clean))
    const group = document.createElement('article')
    group.className = 'message table-draft'
    const label = document.createElement('p')
    label.className = 'message-label'; label.textContent = '表格草稿 · 首行作为表头，确认并发送后保存到对话'
    group.append(label)
    const entries = clean.map((table) => cardFor(table, { draft: true }))
    for (const card of entries) group.append(card.element)
    const discard = document.createElement('button')
    discard.type = 'button'; discard.className = 'discard-table'; discard.textContent = '放弃这组草稿'
    const draft = { group, entries }
    discard.addEventListener('click', () => { group.remove(); drafts.delete(draft); onChange() })
    group.append(discard); drafts.add(draft); messages.append(group)
    onChange(); group.scrollIntoView({ block: 'nearest' })
  }
  return { render, addDrafts,
    hasUnsaved: () => [...cards].some((card) => card.element.isConnected && card.dirty()),
    draftTables: () => normalizeTables([...drafts].flatMap((draft) => draft.entries.map((card) => card.getTable()))),
    clearDrafts() { for (const draft of drafts) draft.group.remove(); drafts.clear(); onChange() },
    reset() { cards.clear(); drafts.clear() },
    setBusy(value, locked = false) {
      busy = value; readOnly = locked
      for (const card of cards) if (card.element.isConnected) card.setBusy(value, locked)
      for (const draft of drafts) draft.group.querySelector('.discard-table').disabled = value
    },
    extractPasted(text) {
      try { const tables = parsePastedTables(text); if (!tables.length) return false; addDrafts(tables); return 'extracted' }
      catch (error) { onError(error.message); return 'error' }
    } }
}

function renderMessage({ body, text, role, cardFor, onSend, details }) {
  const parts = messageParts(text).flatMap((part) => part.type === 'text' ? codeParts(part.text) : [part])
  for (const part of parts) {
    if (part.type === 'text') {
      const paragraph = document.createElement('div')
      paragraph.className = 'message-text'; paragraph.textContent = part.text; body.append(paragraph)
    } else if (part.type === 'workbook') {
      body.append(details.workbook(part.workbook))
    } else if (part.type === 'code') {
      const pre = document.createElement('pre'); pre.className = 'detail-text'; pre.textContent = part.text
      body.append(details.link(part.title, pre))
    } else {
      const card = cardFor(part.table, { confirmed: role === 'user',
        onConfirm: (table) => { details.close(); return onSend([table]) } })
      if (role === 'user') {
        const note = document.createElement('p'); note.className = 'table-source-note'
        note.textContent = '这份表格资料未关联原工作簿，仅能核对已保存的文本。'
        card.element.append(note)
      }
      body.append(details.link(`查看表格：${part.table.title}`, card.element))
    }
  }
}
