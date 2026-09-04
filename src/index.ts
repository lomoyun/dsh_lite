import { fileURLToPath } from 'node:url'
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'

const prompt = process.argv.slice(2).join(' ').trim()

if (prompt === '') {
  process.stderr.write('Usage: pnpm start -- "your request"\n')
  process.exitCode = 2
} else {
  const projectRoot = fileURLToPath(new URL('..', import.meta.url))
  const harness = new DeepSeekHarness({
    profile: 'sdk',
    patches: [fileURLToPath(new URL('../config/dsh-lite.cordis.yml', import.meta.url))],
    dshHome: fileURLToPath(new URL('../.dsh/', import.meta.url)),
    processCwd: projectRoot,
    cwd: process.cwd(),
    provider: process.env.DSH_LITE_PROVIDER ?? 'deepseek-official',
    model: process.env.DSH_LITE_MODEL ?? 'deepseek-v4-flash',
  })

  try {
    const result = await harness.run(prompt)
    process.stdout.write(`${result.finalResponse}\n`)
  } finally {
    await harness.close()
  }
}
