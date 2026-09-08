import assert from 'node:assert/strict'

function client(f) {
  const state = () => fetch(f.base + '/api/prompt-config/state').then((r) => r.json())
  const post = (action, input, origin = f.base) => fetch(`${f.base}/api/prompt-config/${action}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(input),
  })
  const chat = async (sessionId) => {
    const response = await fetch(f.base + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Prompt fixture', sessionId }) })
    assert.equal(response.status, 200, await response.clone().text())
    return response.json()
  }
  const save = async (mode, text) => {
    const revision = (await state()).revision
    const response = await post('save', { mode, text, revision })
    assert.equal(response.status, 200, await response.clone().text())
  }
  return { state, post, chat, save }
}
const systemOf = (received) => received.at(-1).body.messages.filter((m) => ['system', 'developer'].includes(m.role)).map((m) => m.content).join('\n\n')

export async function verifyPromptConfiguration({ f, received }) {
  const api = client(f)
  const initial = await api.state()
  assert.equal(initial.mode, 'inherit')
  assert.ok(initial.preview.system.includes('general-purpose intelligent agent'))
  assert.equal((await api.post('save', {}, 'https://example.com')).status, 403)
  assert.equal((await api.post('save', { mode: 'complete', text: ' ', revision: initial.revision })).status, 400)
  const old = await api.chat()
  const original = systemOf(received)
  const beforePreview = received.length
  const text = 'PROMPT_PERSONA {{model}} / {{provider}}'
  const preview = await api.post('preview', { mode: 'persona', text })
  assert.equal(preview.status, 200, await preview.clone().text())
  const expected = (await preview.json()).system
  assert.equal(received.length, beforePreview)
  assert.equal((await api.state()).mode, 'inherit')
  await api.save('persona', text)
  await api.chat()
  assert.equal(systemOf(received), expected)
  assert.ok(systemOf(received).includes('PROMPT_PERSONA second-model / second-route'))
  assert.ok(!systemOf(received).includes('general-purpose intelligent agent'))
  await api.chat(old.sessionId)
  assert.equal(systemOf(received), original, '已创建的对话保持原提示词')
  const stale = await api.post('save', { mode: 'inherit', text: '', revision: initial.revision })
  assert.equal(stale.status, 409)
  await verifyComplete({ api, received, original })
}
async function verifyComplete({ api, received, original }) {
  const before = received.at(-1).body.tools.map((t) => t.function.name)
  const hadSkills = JSON.stringify(received.at(-1).body.messages).includes('available_skills')
  await api.save('complete', 'ONLY_THIS {{model}}')
  await api.chat()
  assert.equal(systemOf(received), 'ONLY_THIS second-model')
  assert.deepEqual(received.at(-1).body.tools.map((t) => t.function.name), before)
  assert.equal(JSON.stringify(received.at(-1).body.messages).includes('available_skills'), hadSkills, '技能目录不被误删')
  await api.save('inherit', '')
  await api.chat()
  assert.equal(systemOf(received), original)
  await api.save('persona', 'PERSISTED_PROMPT {{model}}')
}
