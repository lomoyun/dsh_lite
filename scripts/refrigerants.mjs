import { fileURLToPath } from 'node:url'
import { loadRefrigerantCatalog, getRefrigerantRecord, searchRefrigerantCatalog } from '../packages/dsh-mche/src/refrigerant-catalog.js'
const filters = { '--contains': 'nameContains', '--sequence': 'sequence', '--category': 'category', '--concentration': 'concentrationPercent', '--basis': 'concentrationBasis', '--offset': 'offset', '--limit': 'limit' }
try {
  const catalog = await loadRefrigerantCatalog(fileURLToPath(new URL('../data/catalogs/refrigerants.json', import.meta.url)))
  const [command, ...args] = process.argv.slice(2)
  let result
  if (command === 'get' && args.length === 1) result = getRefrigerantRecord(catalog, args[0])
  else if (command === 'info' && !args.length) result = { count: catalog.count, categories: catalog.categories, categoryCounts: catalog.categoryCounts, source: catalog.source.path, sha256: catalog.source.sha256 }
  else if (command === 'list') {
    const query = {}
    for (let i = 0; i < args.length; i += 2) {
      const key = filters[args[i]]
      if (!key || args[i + 1] === undefined || Object.hasOwn(query, key)) throw new Error('查询参数无效或重复')
      query[key] = ['sequence', 'concentrationPercent', 'offset', 'limit'].includes(key) ? Number(args[i + 1]) : args[i + 1]
    }
    result = searchRefrigerantCatalog(catalog, query)
  } else throw new Error('用法：refrigerants.mjs info | get <精确标识> | list [--category eg --concentration 30 --basis volume]')
  console.log(JSON.stringify(result, null, 2))
} catch (error) { console.error(error.message); process.exitCode = 1 }
