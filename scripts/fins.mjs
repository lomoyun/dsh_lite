import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { getFin, listFins } from '../src/catalogs/fins.mjs'
import { numericValue } from '../src/catalogs/flat-tubes.mjs'

const help = '用法：node scripts/fins.mjs get B01 | list [--code 310150 --section tube_insert --width 16 --stock-width 21 --height-pre 8.13 --height-post 8.1 --thickness 0.08 --pitch 1.4 --slot-pitch 12 --slot-length 25.4 --slot-width 2 --louver-pitch 1.1 --angle 27 --louvers 12 --contains B --offset 0 --limit 20] | info'
const filters = { code: 'code', section: 'section', contains: 'nameContains', width: 'widthMm', 'stock-width': 'stockWidthMm',
  'height-pre': 'heightPreBrazingMm', 'height-post': 'heightPostBrazingMm', thickness: 'thicknessMm', pitch: 'finPitchMm',
  'slot-pitch': 'slotPitchMm', 'slot-length': 'slotLengthMm', 'slot-width': 'slotWidthMm', 'louver-pitch': 'louverPitchMm',
  angle: 'louverAngleDeg', louvers: 'louverCount', offset: 'offset', limit: 'limit' }
function filterOf(args) {
  const options = Object.fromEntries(Object.keys(filters).map(key => [key, { type: 'string' }]))
  const { values } = parseArgs({ args, options, strict: true })
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [filters[key], ['code', 'section', 'contains'].includes(key) ? value : numericValue(value)]))
}
try {
  const catalog = JSON.parse(await readFile(new URL('../data/catalogs/fins.json', import.meta.url), 'utf8'))
  const [command = 'info', ...args] = process.argv.slice(2)
  let result
  if (command === 'get' && args.length === 1) result = getFin(catalog, args[0])
  else if (command === 'list') result = listFins(catalog, filterOf(args))
  else if (command === 'info' && !args.length) {
    result = { catalogId: catalog.catalogId, count: catalog.count, sectionCounts: catalog.sectionCounts,
      reviewCount: catalog.reviewCount, missingCodeCount: catalog.missingCodeCount, sharedCodeCount: catalog.sharedCodeCount,
      source: { path: catalog.source.path, sha256: catalog.source.sha256, sheet: catalog.source.sheet, dataRanges: catalog.source.dataRanges },
      names: Object.keys(catalog.byName), usage: help }
  } else throw new Error(help)
  console.log(JSON.stringify(result, null, 2))
} catch (error) { console.error(JSON.stringify({ error: error.message, usage: help })); process.exitCode = 1 }
