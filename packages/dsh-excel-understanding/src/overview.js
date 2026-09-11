import { ExcelError } from './limits.js'
import { bounds, intersects } from './ranges.js'
import { confirmedReads } from './read-coverage.js'

const METADATA_PAGE = 12
export function rangeMetadata(sheet, range) {
  const merges = sheet.merges.filter((merge) => intersects(bounds(merge), range))
  const objects = sheet.objects.filter((object) => !object.anchor || intersects(bounds(object.anchor), range))
  return { merges: merges.slice(0, METADATA_PAGE), objects: objects.slice(0, METADATA_PAGE),
    metadataCounts: { merges: merges.length, objects: objects.length },
    metadataPartial: Math.max(merges.length, objects.length) > METADATA_PAGE,
    metadataInstruction: '关联元数据只展示前 12 项；全部对象和合并可用 excel_inspect 的 metadataOffset 继续查阅。' }
}
export function overviewSheets(index, state, offset = 0) {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new ExcelError('元数据分页游标无效')
  return index.sheets.map(({ cells, rows, columns, merges, regions, objects, ...sheet }) => {
    const hiddenRows = rows.flatMap((row, i) => row?.hidden ? [i + 1] : [])
    const hiddenColumns = columns.flatMap((column, i) => column?.hidden ? [i + 1] : [])
    const page = (items) => items.slice(offset, offset + METADATA_PAGE)
    const counts = { regions: regions.length, merges: merges.length, objects: objects.length, hiddenRows: hiddenRows.length, hiddenColumns: hiddenColumns.length }
    return { ...sheet, regions: page(regions), merges: page(merges), objects: page(objects),
      hiddenRows: page(hiddenRows), hiddenColumns: page(hiddenColumns), metadataCounts: counts,
      metadataOffset: offset, nextMetadataOffset: Math.max(...Object.values(counts)) > offset + METADATA_PAGE ? offset + METADATA_PAGE : null,
      sample: Object.values(cells).slice(0, 3).map((cell) => ({ address: cell.address, display: cell.display.slice(0, 60) })),
      readRanges: confirmedReads(state, sheet.name).map((item) => item.range),
      previews: state.previews.filter((item) => item.sheet === sheet.name).slice(-METADATA_PAGE),
    }
  })
}
