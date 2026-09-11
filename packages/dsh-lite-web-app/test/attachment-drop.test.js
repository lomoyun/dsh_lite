import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mountAttachmentDrop } from '../public/attachment-drop.js'

function fixture(t) {
  const saved = { document: globalThis.document, window: globalThis.window }
  const handlers = {}, shown = [], files = [], errors = []
  globalThis.document = { addEventListener: (name, handler) => { handlers[name] = handler } }
  globalThis.window = { addEventListener: (name, handler) => { handlers[name] = handler } }
  t.after(() => Object.assign(globalThis, saved))
  const input = {}, dropzone = {}
  let locked = false
  mountAttachmentDrop({ root: { contains: (target) => target === input },
    dialog: { contains: (target) => target === dropzone }, isLocked: () => locked,
    showDrop: (value) => shown.push(value), onFiles: (items) => files.push(...items), onError: (message) => errors.push(message) })
  const event = (target = input, types = ['Files']) => ({ target, dataTransfer: { types, files: [{ name: 'sample.csv' }] },
    prevented: false, preventDefault() { this.prevented = true } })
  return { handlers, shown, files, errors, input, dropzone, event, lock() { locked = true } }
}

test('拖入输入框或弹窗只加入附件，阻止浏览器直接打开文件并正确收起浮层', (t) => {
  const f = fixture(t), drag = f.event()
  f.handlers.dragenter(drag); f.handlers.dragenter(drag); f.handlers.dragleave(drag)
  assert.equal(true, f.shown.at(-1))
  f.handlers.dragover(drag)
  assert.equal('copy', drag.dataTransfer.dropEffect)
  const drop = f.event(f.dropzone)
  f.handlers.drop(drop)
  assert.equal(true, drop.prevented)
  assert.deepEqual([{ name: 'sample.csv' }], f.files)
  assert.equal(false, f.shown.at(-1))
  f.handlers.dragenter(drag); f.handlers.blur()
  assert.equal(false, f.shown.at(-1))
})

test('发送中或区域外拒绝文件拖入；普通文字拖放保持浏览器原行为', (t) => {
  const f = fixture(t), text = f.event(f.input, ['text/plain'])
  f.handlers.drop(text)
  assert.equal(false, text.prevented)
  const outside = f.event({})
  f.handlers.drop(outside)
  assert.equal(true, outside.prevented)
  f.lock()
  const inside = f.event()
  f.handlers.dragover(inside); f.handlers.drop(inside)
  assert.equal('none', inside.dataTransfer.dropEffect)
  assert.equal(true, inside.prevented)
  assert.equal(0, f.files.length)
  assert.equal(2, f.errors.length)
})
