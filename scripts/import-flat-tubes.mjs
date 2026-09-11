import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve, relative, basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { parseWorkbook } from '../packages/dsh-excel-understanding/src/parser.js'
import { compileFlatTubes, flatTubesCsv, flatTubesJson } from '../src/catalogs/flat-tubes.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
try {
  const path = process.argv[2] ? resolve(process.argv[2]) : resolve(root, '答复_', '1-扁管选型.xls')
  const bytes = await readFile(path), sha256 = createHash('sha256').update(bytes).digest('hex')
  const index = parseWorkbook({ name: basename(path), bytes })
  const catalog = compileFlatTubes({ index, source: { path: relative(root, path).replaceAll('\\', '/'), sha256, bytes: bytes.length } })
  const output = resolve(root, 'data/catalogs/flat-tubes.json')
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, flatTubesJson(catalog))
  await writeFile(resolve(root, 'data/catalogs/flat-tubes.csv'), flatTubesCsv(catalog))
  console.log(JSON.stringify({ count: catalog.count, reviewCount: catalog.reviewCount, sha256, output }, null, 2))
} catch (error) { console.error(error.message); process.exitCode = 1 }
