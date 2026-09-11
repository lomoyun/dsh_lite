import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { LIMITS, ExcelError } from './limits.js'
import { digest } from './store.js'

function processSpec(directory) {
  const script = fileURLToPath(new URL('../renderer/render.py', import.meta.url))
  if (process.platform === 'linux') return { command: '/usr/bin/python3', args: [script, directory] }
  if (process.platform === 'win32' && process.env.EXCEL_RENDER_WSL) {
    const linux = (path) => path.replace(/^([A-Za-z]):/, (_, drive) => `/mnt/${drive.toLowerCase()}`).replaceAll('\\', '/')
    return { command: 'wsl.exe', args: ['-d', process.env.EXCEL_RENDER_WSL, '--', '/usr/bin/python3', linux(script), linux(directory)] }
  }
  throw new ExcelError('原始预览需要 Linux 的 LibreOffice、Poppler、bubblewrap 和 python3-uno；当前环境未启用')
}
function run(spec) {
  return new Promise((resolve, reject) => {
    const child = spawn(spec.command, spec.args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, WSLENV: '' } })
    let stderr = ''
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-2000) })
    const timer = setTimeout(() => { child.kill(); reject(new ExcelError('预览超时；隔离进程将终止')) }, LIMITS.previewMs + 5000)
    child.once('error', () => { clearTimeout(timer); reject(new ExcelError('预览依赖不可用')) })
    child.once('close', (code) => {
      clearTimeout(timer)
      if (code) reject(new ExcelError(`预览生成失败；未完成视觉核验。${stderr.includes('Operation not permitted') ? '当前主机不允许创建隔离沙箱。' : ''}`))
      else resolve()
    })
  })
}
export async function renderPreview({ directory, meta, sheet, range }) {
  const id = randomUUID(), job = join(directory, 'previews', id)
  const input = join(job, 'input'), output = join(job, 'output')
  const spec = processSpec(job)
  const original = await readFile(join(directory, 'original'))
  if (digest(original) !== meta.sha256) throw new ExcelError('原文件摘要不一致，拒绝生成预览')
  await mkdir(input, { recursive: true }); await mkdir(output)
  const filename = `workbook.${meta.format}`
  await writeFile(join(input, filename), original)
  await writeFile(join(input, 'request.json'), JSON.stringify({ filename, sheet, range }))
  await run(spec)
  const manifest = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'))
  const files = await readdir(output), pages = []
  let total = 0
  for (const filename of files) {
    const bytes = await readFile(join(output, filename)); total += bytes.length
    const match = /^page-(\d+)\.png$/.exec(filename)
    if (match) pages.push({ page: Number(match[1]), filename, sha256: digest(bytes), bytes: bytes.length })
  }
  if (total > LIMITS.previewBytes || !pages.length || pages.length > LIMITS.previewPages) throw new ExcelError('预览超出输出限制或没有有效页面')
  const pdfSha256 = digest(await readFile(join(output, 'preview.pdf')))
  return { id, sheet, range: range ?? null, status: 'ready', ...manifest, pdfSha256, pages: pages.sort((a, b) => a.page - b.page),
    pdfBytes: (await stat(join(output, 'preview.pdf'))).size }
}
