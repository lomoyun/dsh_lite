import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

async function get(f) { return (await fetch(f.base + '/api/workspace/state')).json() }
async function post(f, path, input, expected = 200) {
  const response = await fetch(f.base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
  const data = await response.json()
  assert.equal(response.status, expected, JSON.stringify(data))
  return data
}
const system = (received) => received.at(-1).body.messages.find((m) => m.role === 'system')?.content

export async function verifyWorkspace({ f, received }) {
  let state = await get(f)
  assert.equal(state.workspaces[0].id, 'default')
  assert.ok(state.sessions.length > 0)
  assert.equal(state.sessions.every((s) => s.projectId === null), true)
  const project = { name: '项目一', instructions: 'PROJECT_RULE {{literal}}', promptMode: 'complete',
    promptText: 'PROJECT_PROMPT {{model}}', model: { provider: 'fixture-route', model: 'fixture-model' } }
  await post(f, '/api/workspace/project', { ...project, revision: state.revision })
  await post(f, '/api/workspace/project', { ...project, revision: state.revision }, 409)
  state = await get(f)
  const projectId = state.projects[0].id
  const reply = await post(f, '/api/chat', { prompt: '项目中的第一条消息', projectId })
  assert.equal(reply.provider, 'fixture-route')
  assert.equal(reply.model, 'fixture-model')
  const original = system(received)
  assert.match(original, /PROJECT_PROMPT fixture-model/)
  assert.match(original, /PROJECT_RULE \{\{literal\}\}/)
  const metadata = JSON.parse(await readFile(join(f.home, 'lite-workspace.json'), 'utf8'))
  assert.equal(metadata.sessions.find((s) => s.id === reply.sessionId).snapshot.system, original)
  assert.doesNotMatch(JSON.stringify(metadata), /fixture-not-a-real-secret|second-fixture-not-a-real-secret/)
  const calls = received.length
  await post(f, '/api/session/close', { sessionId: reply.sessionId })
  const opened = await post(f, '/api/session/open', { sessionId: reply.sessionId })
  assert.equal(received.length, calls, '打开历史不能调用模型')
  assert.deepEqual(opened.messages.map((m) => m.role), ['user', 'assistant'])
  assert.equal(opened.messages[0].text, '项目中的第一条消息')
  assert.equal(opened.sessionUsage.totalTokens, 120)
  assert.equal(opened.readOnlyReason, '')
  state = await get(f)
  await post(f, '/api/workspace/project', { ...project, id: projectId, name: '项目已改名',
    promptText: 'NEW_PROJECT_PROMPT', instructions: 'NEW_RULE', revision: state.revision })
  const continued = await post(f, '/api/chat', { prompt: '继续项目会话', sessionId: reply.sessionId,
    choice: { provider: 'second-route', model: 'second-model' } })
  assert.equal(continued.sessionId, reply.sessionId)
  assert.equal(continued.sessionUsage.totalTokens, 240)
  assert.equal(system(received), original)
  assert.equal(continued.model, 'fixture-model')
  await verifySessionEdits(f, reply.sessionId)
  return { sessionId: reply.sessionId, original }
}

async function verifySessionEdits(f, sessionId) {
  let state = await get(f)
  await post(f, '/api/workspace/session', { id: sessionId, title: '保留的会话', projectId: null, archived: true, revision: state.revision })
  const opened = await post(f, '/api/session/open', { sessionId })
  assert.match(opened.readOnlyReason, /归档/)
  await post(f, '/api/chat', { sessionId, prompt: '不能发送' }, 409)
  state = await get(f)
  await post(f, '/api/workspace/session', { id: sessionId, archived: false, revision: state.revision })
  state = await get(f)
  assert.equal(state.sessions.find((s) => s.id === sessionId).title, '保留的会话')
  assert.equal(state.sessions.find((s) => s.id === sessionId).projectId, null)
}

export async function verifyWorkspaceRestart({ f, received, saved }) {
  const count = received.length
  const opened = await post(f, '/api/session/open', { sessionId: saved.sessionId })
  assert.equal(opened.sessionUsage.totalTokens, 240)
  assert.equal(opened.title, '保留的会话')
  assert.equal(received.length, count)
  const reply = await post(f, '/api/chat', { sessionId: saved.sessionId, prompt: '重启后继续' })
  assert.equal(reply.sessionUsage.totalTokens, 360)
  assert.equal(reply.sessionId, saved.sessionId)
  assert.equal(system(received), saved.original)
  assert.match(JSON.stringify(received.at(-1).body.messages), /项目中的第一条消息/)
}
