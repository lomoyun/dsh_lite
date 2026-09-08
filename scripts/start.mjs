import { mkdir, copyFile, writeFile, constants } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'

const root = fileURLToPath(new URL('../', import.meta.url))
// 环境仅加载一次；DSH 的工作目录避开含 DSH_* 变量的项目 .env。
try { process.loadEnvFile(join(root, '.env')) }
catch (error) { if (error.code !== 'ENOENT') throw error }
const home = resolve(process.env.DSH_HOME || join(root, '.dsh'))
const profile = join(home, 'profiles', 'lite')
await mkdir(profile, { recursive: true })
for (const name of ['package.json', 'pnpm-workspace.yaml']) {
  try {
    await copyFile(join(root, 'profiles/lite', name), join(profile, name), constants.COPYFILE_EXCL)
  } catch (error) { if (error.code !== 'EEXIST') throw error }
}
try { await writeFile(join(profile, 'cordis.patch.yml'), '[]\n', { flag: 'wx' }) }
catch (error) { if (error.code !== 'EEXIST') throw error }
process.env.DSH_HOME = home
process.env.LITE_PROJECT_CWD ??= root
const require = createRequire(import.meta.url)
const bin = join(dirname(require.resolve('@deepseek-ai/dsh/package.json')), 'lib/bin.js')
process.chdir(home)
const args = process.argv.slice(2)
process.argv = args[0] === 'plugin'
  ? [process.execPath, bin, 'plugin', '--profile', 'lite', ...args.slice(1)]
  : [process.execPath, bin, '--profile', 'lite', ...args]
await import(pathToFileURL(bin).href)
