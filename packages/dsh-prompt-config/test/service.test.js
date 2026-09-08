import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validate, overrideAssembly } from '../src/service.js'

test('拒绝空自定义提示词、非法模式、过长文本和未知变量', () => {
  for (const input of [null, [], { mode: 'x', text: 'a' }, { mode: 'persona', text: ' ' },
    { mode: 'complete', text: 'a'.repeat(24001) }, { mode: 'persona', text: '{{secret}}' }]) {
    assert.throws(() => validate(input))
  }
  assert.deepEqual(validate({ mode: 'persona', text: '{{model}} {{provider}} {{cwd}}' }),
    { mode: 'persona', text: '{{model}} {{provider}} {{cwd}}' })
})
test('三种覆盖模式不修改原始组装、不删除工具和独立上下文', () => {
  const assembly = { sections: [{ name: 'harness:identity', text: 'identity' },
    { name: 'deployment:persona', text: 'old' }, { name: 'tool:help', text: 'help' }],
  contexts: [{ name: 'runtime', text: 'cwd' }], tools: [{ name: 'skill' }], variables: {} }
  assert.equal(overrideAssembly(assembly, { mode: 'inherit' }), assembly)
  const persona = overrideAssembly(assembly, { mode: 'persona', text: 'new' })
  assert.deepEqual(persona.sections.map((s) => s.text), ['identity', 'new', 'help'])
  const complete = overrideAssembly(assembly, { mode: 'complete', text: 'only' })
  assert.deepEqual(complete.sections.map((s) => s.text), ['only'])
  assert.equal(complete.tools, assembly.tools)
  assert.equal(complete.contexts, assembly.contexts)
  assert.equal(assembly.sections[1].text, 'old')
})
