import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, relative, basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { parseWorkbook } from '../packages/dsh-excel-understanding/src/parser.js'
import { compileRefrigerants, refrigerantsCsv, refrigerantsJson } from '../src/catalogs/refrigerants.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
try {
  const path = process.argv[2] ? resolve(process.argv[2]) : resolve(root, '答复_', '5-冷媒库.xlsx'), bytes = await readFile(path)
  const catalog = compileRefrigerants({ index: parseWorkbook({ name: basename(path), bytes }), source: {
    path: relative(root, path).replaceAll('\\', '/'), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } })
  const target = resolve(root, 'data/catalogs/refrigerants.json')
  await mkdir(dirname(target), { recursive: true }); await writeFile(target, refrigerantsJson(catalog))
  await writeFile(resolve(root, 'data/catalogs/refrigerants.csv'), refrigerantsCsv(catalog))
  console.log(JSON.stringify({ count: catalog.count, categoryCounts: catalog.categoryCounts, source: catalog.source.path, sha256: catalog.source.sha256, target }, null, 2))
} catch (error) { console.error(error.message); process.exitCode = 1 }
