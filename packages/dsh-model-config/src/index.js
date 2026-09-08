import z from '@deepseek-ai/schemastery'
import { createConfigHandler } from './http.js'
import { NS } from './validation.js'

export const name = 'model-config-ui'
export const inject = ['llm', 'settings', 'credentials', 'agentDefaultModel', 'webServer']
export const Config = z.object({
  maxTokens: z.number().default(8192),
  modelLimits: z.array(z.object({ provider: z.string(), model: z.string(), maxTokens: z.number() })).default([]),
})

export function apply(ctx, config) {
  ctx.settings.register(NS, Config, { base: config })
  const handler = createConfigHandler(ctx)
  for (const path of ['/models', '/api/model-config']) {
    ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path, handler }))
  }
}
