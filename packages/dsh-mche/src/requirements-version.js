import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

export const REQUIREMENTS_RULES = createHash('sha256').update(JSON.stringify(['fields', 'parser', 'mapping', 'derived', 'boundary', 'service', 'version']
  .map(name => readFileSync(new URL(`./requirements-${name}.js`, import.meta.url), 'utf8')))).digest('hex')
