import z from '@deepseek-ai/schemastery'
import { createWebHandler, WEB_PATHS } from './http.js'
import { createChatRuntime } from './runtime.js'
import { DEFAULT_TIMEOUT_MS, DEFAULT_IDLE_TIMEOUT_MS } from './turn-budget.js'

export const name = 'lite-web-app'
export const inject = ['webServer', 'agents', 'llm', 'settings', 'credentials', 'agentDefaultModel', 'tools', 'sessions']
export const Config = z.object({
  cwd: z.string().required(),
  timeoutMs: z.number().min(1).default(DEFAULT_TIMEOUT_MS),
  idleTimeoutMs: z.number().min(1).default(DEFAULT_IDLE_TIMEOUT_MS),
  maxSessions: z.number().min(1).default(32),
})

export function apply(ctx, config) {
  const runtime = createChatRuntime(ctx, config)
  ctx.on('dispose', runtime.close)
  const handler = createWebHandler(runtime)
  for (const path of WEB_PATHS) {
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path, handler }))
  }
  console.log(`DSH Lite: http://127.0.0.1:${ctx.webServer.port}`)
}
