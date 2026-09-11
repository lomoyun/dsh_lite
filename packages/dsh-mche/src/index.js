import { Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { join } from 'node:path'
import { McheService } from './service.js'
import { installTools } from './tools.js'
import { compactCase } from './tool-output.js'
import { createMcheHandler } from './http.js'

export const name = 'mche'
export const inject = ['tools', 'webServer', 'liteWorkspace']
export const Config = z.object({ home: z.string().required(), cwd: z.string().required(),
  pythonX86: z.string(), runtimeRoot: z.string(), calculationTimeoutMs: z.number().default(120000) })
export function apply(ctx, config) {
  const service = new McheService({ root: join(config.home, 'mche', 'cases'), excel: () => ctx.get('excelUnderstanding')?.service, catalogPath: join(config.cwd, 'data', 'catalogs', 'flat-tubes.json'),
    finCatalogPath: join(config.cwd, 'data', 'catalogs', 'fins.json'), refrigerantCatalogPath: join(config.cwd, 'data', 'catalogs', 'refrigerants.json'),
    calculation: { root: join(config.home, 'mche', 'runs'),
      python: config.pythonX86 || process.env.MCHE_PYTHON_X86 || join(config.cwd, '.dsh', 'mche-python-x86', 'python.exe'),
      runtimeRoot: config.runtimeRoot || process.env.MCHE_RUNTIME_ROOT || join(config.cwd, 'runtime'),
      timeoutMs: config.calculationTimeoutMs } })
  if (!Number.isFinite(config.calculationTimeoutMs) || config.calculationTimeoutMs < 1000 || config.calculationTimeoutMs > 3600000) throw new Error('calculationTimeoutMs must be between 1000 and 3600000')
  const bridge = new Service(ctx, 'liteMche')
  bridge.current = async (sessionId) => {
    const state = await service.store.view(sessionId)
    return compactCase(await service.decorate(state))
  }
  bridge.beginTurn = (sessionId, input) => service.calculations.beginTurn(sessionId, input)
  bridge.endTurn = sessionId => service.calculations.endTurn(sessionId)
  installTools(ctx, service)
  const handler = createMcheHandler(service, ctx)
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/api/mche', handler }))
  ctx.on('dispose', () => service.close())
}
