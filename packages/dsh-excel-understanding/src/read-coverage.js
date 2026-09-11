import XLSX from 'xlsx'
import { ExcelError } from './limits.js'
import { bounds, intersects } from './ranges.js'

export const READ_VERSION = 2
export const confirmedReads = (state, sheet) => state.reads.filter((read) => read.version === READ_VERSION && read.sheet === sheet)
export function subtractRange(target, read) {
  if (!intersects(target, read)) return [target]
  const top = Math.max(target.s.r, read.s.r), bottom = Math.min(target.e.r, read.e.r)
  const left = Math.max(target.s.c, read.s.c), right = Math.min(target.e.c, read.e.c)
  const pieces = [], add = (sr, sc, er, ec) => { if (sr <= er && sc <= ec) pieces.push({ s: { r: sr, c: sc }, e: { r: er, c: ec } }) }
  add(target.s.r, target.s.c, top - 1, target.e.c)
  add(bottom + 1, target.s.c, target.e.r, target.e.c)
  add(top, target.s.c, bottom, left - 1)
  add(top, right + 1, bottom, target.e.c)
  return pieces
}
export function missingRanges(state, sheet, reference) {
  let remaining = [bounds(reference)]
  for (const read of confirmedReads(state, sheet)) {
    remaining = remaining.flatMap((part) => subtractRange(part, bounds(read.range)))
    if (!remaining.length) break
  }
  return remaining.map(XLSX.utils.encode_range)
}
export function requireRead(context, sheet, range) {
  const missing = missingRanges(context.state, sheet, range)
  if (!missing.length) return
  const diagnostic = { kind: 'EXCEL_COVERAGE_INCOMPLETE', fileId: context.meta.fileId, sheet, claimedRange: range,
    missingRanges: missing.slice(0, 12), missingRangeCount: missing.length,
    instruction: '尚未读取完整原文。请用 excel_read_range 补读 missingRanges，并继续 nextRanges；旧版已读记录需重新读取。' }
  throw new ExcelError(JSON.stringify(diagnostic))
}
export function recordRead(state, input) {
  if (confirmedReads(state, input.sheet).some((read) => read.range === input.returnedRange)) return false
  state.reads.push({ sheet: input.sheet, range: input.returnedRange, version: READ_VERSION })
  return true
}
