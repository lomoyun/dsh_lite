import { Worker } from 'node:worker_threads'
import { TABLE_LIMITS } from '../public/table-data.js'

const PARSE_TIMEOUT_MS = 10000

function parseInWorker(input) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./table-import-worker.js', import.meta.url), {
      workerData: input, resourceLimits: { maxOldGenerationSizeMb: 128 },
    })
    const timer = setTimeout(() => {
      reject(new Error('文件解析超时，请拆分工作表后重试'))
      void worker.terminate()
    }, PARSE_TIMEOUT_MS)
    worker.once('message', (message) => {
      clearTimeout(timer)
      if (message.ok) resolve(message.value)
      else reject(new Error(message.error))
    })
    worker.once('error', () => { clearTimeout(timer); reject(new Error('文件无法解析，请检查文件或拆分后重试')) })
    worker.once('exit', (code) => { clearTimeout(timer); if (code) reject(new Error('文件解析未完成，请拆分后重试')) })
  })
}

export async function importTableFile(request) {
  if (!request.headers['content-type']?.startsWith('application/octet-stream')) throw new Error('请添加附件后发送')
  const declared = Number(request.headers['content-length'] ?? 0)
  if (declared > TABLE_LIMITS.fileBytes) throw new Error('文件超过 5 MB，请拆分后上传')
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > TABLE_LIMITS.fileBytes) throw new Error('文件超过 5 MB，请拆分后上传')
    chunks.push(chunk)
  }
  const name = decodeURIComponent(request.headers['x-file-name'] ?? '')
  return parseInWorker({ name, encoding: request.headers['x-text-encoding'] ?? 'auto', bytes: Buffer.concat(chunks) })
}
