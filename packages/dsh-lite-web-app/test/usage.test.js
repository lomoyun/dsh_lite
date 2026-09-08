import assert from 'node:assert/strict'
import { test } from 'node:test'
import { summarizeUsage } from '../src/usage.js'

const event = (usage) => ({ type: 'assistant/message', data: { usage } })
test('汇总多步骤用量，不重复计算流式 token，不把缓存和推理 token 叠加进总量', () => {
  const usage = summarizeUsage([
    { type: 'assistant/chunk', data: { chunk: { type: 'usage', usage: { totalTokens: 999 } } } },
    event({ inputTokens: 40, outputTokens: 20, totalTokens: 120, cacheReadTokens: 60, reasoningTokens: 10 }),
    event({ inputTokens: 50, outputTokens: 5, totalTokens: 55 }),
  ])
  assert.equal(usage.inputTokens, 90)
  assert.equal(usage.outputTokens, 25)
  assert.equal(usage.totalTokens, 175)
  assert.equal(usage.cacheReadTokens, 60)
  assert.equal(usage.reasoningTokens, 10)
  assert.equal(usage.complete, true)
})
test('缺失用量不伪装成零，部分上报标记不完整', () => {
  assert.equal(summarizeUsage([event()]).totalTokens, null)
  const partial = summarizeUsage([event(), event({ inputTokens: 0, outputTokens: 0 })])
  assert.equal(partial.complete, false)
  assert.equal(partial.reportedCalls, 1)
  assert.equal(partial.inputTokens, 0)
  assert.equal(partial.totalTokens, null)
})
