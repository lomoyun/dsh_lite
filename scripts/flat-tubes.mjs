import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { getFlatTube, listFlatTubes, numericValue } from '../src/catalogs/flat-tubes.mjs'

const help = '用法：node scripts/flat-tubes.mjs get A01S | list [--width 16 --height 1.8 --ports 10 --contains A --offset 0 --limit 20] | info'
function filterOf(args) {
  const fields = { width: 'widthMm', height: 'heightMm', ports: 'portCount', contains: 'nameContains', offset: 'offset', limit: 'limit' }
  const options = Object.fromEntries(Object.keys(fields).map(key => [key, { type: 'string' }]))
  const { values } = parseArgs({ args, options, strict: true })
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [fields[key], key === 'contains' ? value : numericValue(value)]))
}
try {
  const catalog = JSON.parse(await readFile(new URL('../data/catalogs/flat-tubes.json', import.meta.url), 'utf8'))
  const [command = 'info', ...args] = process.argv.slice(2)
  let result
  if (command === 'get' && args.length === 1) result = getFlatTube(catalog, args[0])
  else if (command === 'list') result = listFlatTubes(catalog, filterOf(args))
  else if (command === 'info' && !args.length) {
    const { byName, ...info } = catalog
    result = { ...info, names: Object.keys(byName), usage: help }
  } else throw new Error(help)
  console.log(JSON.stringify(result, null, 2))
} catch (error) { console.error(JSON.stringify({ error: error.message, usage: help })); process.exitCode = 1 }
