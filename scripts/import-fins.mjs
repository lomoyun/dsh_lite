import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve, relative, basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { parseWorkbook } from '../packages/dsh-excel-understanding/src/parser.js'
import { compileFins, finsCsv, finsJson } from '../src/catalogs/fins.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
try {
  const path = process.argv[2] ? resolve(process.argv[2]) : resolve(root, '答复_', '2-翅片选型.xls')
  const bytes = await readFile(path), sha256 = createHash('sha256').update(bytes).digest('hex')
  const index = parseWorkbook({ name: basename(path), bytes })
  const catalog = compileFins({ index, source: { path: relative(root, path).replaceAll('\\', '/'), sha256, bytes: bytes.length } })
  const json = finsJson(catalog), csv = finsCsv(catalog)
  const output = resolve(root, 'data/catalogs/fins.json')
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, json)
  await writeFile(resolve(root, 'data/catalogs/fins.csv'), csv)
  console.log(JSON.stringify({ count: catalog.count, sectionCounts: catalog.sectionCounts, reviewCount: catalog.reviewCount,
    missingCodeCount: catalog.missingCodeCount, sharedCodeCount: catalog.sharedCodeCount, sha256, output }, null, 2))
} catch (error) { console.error(error.message); process.exitCode = 1 }
