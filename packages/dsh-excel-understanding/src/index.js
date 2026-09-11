import { Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { join } from 'node:path'
import { ExcelService } from './service.js'
import { createExcelHandler } from './http.js'
import { installTools } from './tools.js'
import { syncReadReceipts } from './read-receipts.js'

export const name = 'excel-understanding'
export const inject = ['tools', 'llm', 'attachments', 'webServer']
export const Config = z.object({ home: z.string().required() })

export function apply(ctx, config) {
  const service = new ExcelService({ root: join(config.home, 'excel-understanding', 'files'), ctx })
  const bridge = new Service(ctx, 'excelUnderstanding')
  bridge.service = service
  bridge.syncReads = (agent) => syncReadReceipts(service, agent)
  installTools(ctx, service)
  const handler = createExcelHandler(service, ctx)
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/api/excel', handler }))
}
