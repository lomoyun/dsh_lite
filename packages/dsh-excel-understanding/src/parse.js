import { Worker } from 'node:worker_threads'
import { LIMITS, ExcelError } from './limits.js'

export function parseInWorker(input) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./parse-worker.js', import.meta.url), {
      workerData: input, resourceLimits: { maxOldGenerationSizeMb: LIMITS.workerMb },
    })
    let done = false
    const finish = (error, value) => {
      if (done) return
      done = true; clearTimeout(timer); void worker.terminate()
      if (error) reject(new ExcelError(error)); else resolve(value)
    }
    const timer = setTimeout(() => finish('工作簿解析超时，原文件已保存，请拆分后重试'), LIMITS.parseMs)
    worker.once('message', (message) => finish(message.ok ? null : message.error, message.value))
    worker.once('error', () => finish('工作簿解析失败或超过内存限制，原文件已保存'))
    worker.once('exit', () => finish('工作簿解析未完成，原文件已保存'))
  })
}
