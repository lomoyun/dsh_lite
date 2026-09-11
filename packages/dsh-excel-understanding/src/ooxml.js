import { posix } from 'node:path'
import { XMLParser } from 'fast-xml-parser'
import XLSX from 'xlsx'
import { ExcelError } from './limits.js'

const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false, processEntities: true })
const array = (value) => value == null ? [] : Array.isArray(value) ? value : [value]
function xml(files, path) {
  const text = files.get(path)?.toString('utf8') ?? ''
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new ExcelError('不支持包含外部实体的 XML')
  return text ? parser.parse(text) : {}
}
function relations(files, part) {
  const path = posix.join(posix.dirname(part), '_rels', posix.basename(part) + '.rels')
  return array(xml(files, path).Relationships?.Relationship).map((item) => ({
    id: item['@_Id'], type: item['@_Type']?.split('/').at(-1), external: item['@_TargetMode'] === 'External',
    target: item['@_Target']?.startsWith('/') ? item['@_Target'].slice(1) : posix.normalize(posix.join(posix.dirname(part), item['@_Target'] ?? '')),
  }))
}
function anchorRange(anchor) {
  if (!anchor.from) return null
  const point = (p) => ({ r: Number(p.row), c: Number(p.col) })
  return XLSX.utils.encode_range({ s: point(anchor.from), e: point(anchor.to ?? anchor.from) })
}
function drawingObjects(files, relation) {
  const drawing = xml(files, relation.target).wsDr ?? {}, refs = relations(files, relation.target)
  return ['twoCellAnchor', 'oneCellAnchor', 'absoluteAnchor'].flatMap((kind) => array(drawing[kind]).map((anchor) => {
    const id = anchor.pic?.blipFill?.blip?.['@_embed']
    return { kind: anchor.pic ? 'image' : 'drawing', anchor: anchorRange(anchor), anchorType: kind,
      part: relation.target, mediaPart: refs.find((ref) => ref.id === id && !ref.external)?.target ?? null,
      description: anchor.pic?.nvPicPr?.cNvPr?.['@_descr'] ?? '', status: 'needs_visual_check' }
  }))
}
function vmlObjects(files, relation) {
  const root = xml(files, relation.target).xml ?? {}
  return array(root.shape).map((shape) => {
    const data = shape.ClientData ?? {}, checkbox = data['@_ObjectType'] === 'Checkbox'
    const row = Number(data.Row), col = Number(data.Column)
    return { kind: checkbox ? 'checkbox' : 'legacy_drawing', part: relation.target,
      anchor: Number.isInteger(row) && Number.isInteger(col) ? XLSX.utils.encode_cell({ r: row, c: col }) : null,
      checked: checkbox && data.Checked != null ? String(data.Checked) === '1' : null,
      basis: 'vml', linkedCell: data.FmlaLink ?? null, status: 'needs_visual_check' }
  })
}
function objectsFor(files, part) {
  return relations(files, part).flatMap((relation) => {
    if (relation.external) return [{ kind: 'external_link', part, status: 'not_loaded' }]
    if (relation.type === 'drawing') return drawingObjects(files, relation)
    if (relation.type === 'vmlDrawing') return vmlObjects(files, relation)
    if (relation.type === 'ctrlProp') {
      const control = xml(files, relation.target).formControlPr ?? {}
      const checkbox = control['@_objectType'] === 'CheckBox', state = control['@_checked']
      return [{ kind: checkbox ? 'checkbox' : 'control', part: relation.target, anchor: null,
        checked: checkbox && ['Checked', 'Unchecked'].includes(state) ? state === 'Checked' : null,
        basis: 'ooxml_control', linkedCell: control['@_fmlaLink'] ?? null, status: checkbox ? 'needs_visual_check' : 'unsupported' }]
    }
    if (['control', 'oleObject'].includes(relation.type)) return [{ kind: relation.type, part: relation.target, status: 'unsupported' }]
    return []
  })
}
export function readObjects(files) {
  if (!files) return { sheets: new Map(), formulasWithoutCache: new Map(), issues: [] }
  const workbook = xml(files, 'xl/workbook.xml').workbook, refs = relations(files, 'xl/workbook.xml')
  const formulasWithoutCache = new Map()
  const sheets = new Map(array(workbook?.sheets?.sheet).map((sheet) => {
    const part = refs.find((ref) => ref.id === sheet['@_id'] && !ref.external)?.target
    const rows = part ? array(xml(files, part).worksheet?.sheetData?.row) : []
    formulasWithoutCache.set(sheet['@_name'], rows.flatMap((row) => array(row.c))
      .filter((cell) => Object.hasOwn(cell, 'f') && (cell.v == null || cell.v === '')).map((cell) => cell['@_r']))
    return [sheet['@_name'], part ? objectsFor(files, part) : []]
  }))
  const issues = []
  const sensitive = [...files.keys()].filter((part) => /vbaProject|activeX|externalLinks|slicer|pivot|threadedComment|connections|ctrlProp|richData/i.test(part))
  if (sensitive.length) issues.push({ code: 'unsupported_parts', message: '存在宏、链接、控件或扩展对象；未执行，需核对。', parts: sensitive })
  return { sheets, formulasWithoutCache, issues }
}
