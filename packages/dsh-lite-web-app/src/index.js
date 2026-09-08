import z from '@deepseek-ai/schemastery'
import { createWebHandler } from './http.js'
import { createChatRuntime } from './runtime.js'

export const name = 'lite-web-app'
export const inject = ['webServer', 'agents', 'llm', 'settings', 'credentials', 'agentDefaultModel']
export const Config = z.object({
  cwd: z.string().required(),
  timeoutMs: z.number().min(1).default(180000),
  maxSessions: z.number().min(1).default(32),
})

export function apply(ctx, config) {
  const runtime = createChatRuntime(ctx, config)
  ctx.on('dispose', runtime.close)
  const handler = createWebHandler(runtime)
  for (const path of ['/', '/app.js', '/style.css', '/sidebar.js', '/project-dialog.js', '/workspace.css', '/api/status', '/api/chat', '/api/session/close', '/api/session/open']) {
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path, handler }))
  }
  console.log(`DSH Lite: http://127.0.0.1:${ctx.webServer.port}`)
}
