import z from '@deepseek-ai/schemastery'
import { Service } from '@deepseek-ai/cordis'
import { createHandler } from './http.js'
import { mountPrompt, NS, validate } from './service.js'

export const name = 'prompt-config-ui'
export const inject = ['systemPrompt', 'agents', 'settings', 'agentDefaultModel', 'webServer']
export const Config = z.object({
  mode: z.union(['inherit', 'persona', 'complete']).default('inherit'),
  text: z.string().default(''),
})

export function apply(ctx, config) {
  new Service(ctx, 'promptSnapshots')
  ctx.settings.register(NS, Config, { base: config,
    validate: (value) => { validate(value) } })
  const active = new Set()
  // 文本在 Agent 创建时固定，不随后续页面保存而改变。
  ctx.on('agent/created', ({ agent }) => {
    const snapshot = ctx.get('liteWorkspace')?.record(agent.id)?.snapshot
    const disposers = []
    if (snapshot?.system) {
      disposers.push(agent.ctx.systemPrompt.variable('lite_frozen_prompt', () => snapshot.system))
      disposers.push(mountPrompt(agent.ctx, { mode: 'complete', text: '{{lite_frozen_prompt}}' }))
    } else {
      const draft = validate(snapshot?.prompt ?? ctx.settings.get(NS))
      if (snapshot?.instructions) {
        disposers.push(agent.ctx.systemPrompt.variable('lite_project_instructions', () => snapshot.instructions))
        if (draft.mode === 'complete') draft.text += '\n\n项目说明：\n{{lite_project_instructions}}'
        else disposers.push(agent.ctx.systemPrompt.section({ name: 'lite:project', order: 50,
          text: '项目说明：\n{{lite_project_instructions}}' }))
      }
      disposers.push(mountPrompt(agent.ctx, draft))
    }
    const dispose = () => { for (const stop of disposers) stop() }
    active.add(dispose)
    agent.ctx.on('dispose', () => active.delete(dispose))
  })
  ctx.on('dispose', () => { for (const dispose of active) dispose(); active.clear() })
  const handler = createHandler(ctx)
  for (const path of ['/prompts', '/api/prompt-config']) {
    ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path, handler }))
  }
}
