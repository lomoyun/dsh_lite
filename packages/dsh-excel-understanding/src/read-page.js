import XLSX from 'xlsx'
import { LIMITS } from './limits.js'
import { contains, pageOf, quoteOf, validRange } from './ranges.js'
import { rangeMetadata } from './overview.js'
import { READ_VERSION, subtractRange, confirmedReads } from './read-coverage.js'

export function readPage(input, sheet, state) {
  const requested = validRange(sheet, input.range, Infinity)
  return pageOf(sheet, requested, ({ range, reference, cells }) => ({
    fileId: input.fileId, sessionId: input.sessionId, sheet: sheet.name, readVersion: READ_VERSION,
    requestedRange: input.range, returnedRange: reference, partial: !contains(range, requested),
    nextRanges: subtractRange(requested, range).map(XLSX.utils.encode_range),
    cells, quote: quoteOf(sheet, reference), ...rangeMetadata(sheet, range), hidden: sheet.hidden,
    responseByteLimit: LIMITS.responseBytes, confirmedReadRangeCount: confirmedReads(state, sheet.name).length,
  }))
}
