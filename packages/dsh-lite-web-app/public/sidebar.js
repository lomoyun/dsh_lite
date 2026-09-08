import { editRecord } from './project-dialog.js'
const $ = (s) => document.querySelector(s)
export async function api(path, input) {
  const response = await fetch(path, input === undefined ? undefined : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || '操作失败，请重新加载后重试')
  return data
}
export function createSidebar(callbacks) { return new Sidebar(callbacks) }
class Sidebar {
  constructor(callbacks) {
    this.callbacks = callbacks
    this.state = { projects: [], sessions: [] }
    this.project = null
    this.selected = undefined
    this.busy = false
    this.archived = false
    this.enabled = false
    $('#new-project').onclick = () => this.edit('project').catch((error) => this.error(error))
    $('#show-archived').onchange = (event) => { this.archived = event.target.checked; this.render() }
    $('#sidebar-toggle').onclick = () => {
      const open = document.body.classList.toggle('sidebar-open')
      $('#sidebar-toggle').setAttribute('aria-expanded', String(open))
    }
  }
  remember() {
    try { localStorage.setItem('dsh-lite.selection', JSON.stringify({ projectId: this.project, sessionId: this.selected })) } catch {}
  }
  error(error) { $('#workspace-status').textContent = error.message }
  action(label, fn, className = '') {
    const button = document.createElement('button')
    button.type = 'button'; button.className = className; button.textContent = label
    button.disabled = this.busy
    button.onclick = () => Promise.resolve(fn()).catch((error) => this.error(error))
    return button
  }
  heading() {
    const project = this.state.projects.find((p) => p.id === this.project)
    $('#breadcrumbs').textContent = `个人工作区 / ${project?.name ?? '未归类'}`
    $('#project-summary').textContent = project ? `${project.model?.model ?? '全局默认模型'} · ${project.prompt?.mode === 'inherit' ? '全局提示词' : '项目提示词'}${project.archived ? ' · 已归档' : ''}` : '未归类的独立会话'
    $('#project-summary').hidden = !this.enabled
  }
  async edit(kind, record) {
    if (this.busy) return
    await editRecord({ kind, record, state: this.state, save: async (input) => {
      await api(`/api/workspace/${kind}`, input)
      await this.refresh()
      if (this.selected) await this.callbacks.open(this.selected)
      else this.callbacks.projectChanged()
      $('#workspace-status').textContent = '已保存'
    } })
  }
  async choose(project) {
    if (!this.callbacks.canSwitch()) return
    if (project?.archived) { $('#workspace-status').textContent = '项目已归档，可查看历史或在设置中恢复。'; return }
    await this.callbacks.fresh()
    this.project = project?.id ?? null; this.selected = undefined
    this.remember(); this.render(); this.callbacks.projectChanged()
  }
  group(project) {
    const key = project?.id ?? null
    const section = document.createElement('section')
    const row = document.createElement('div'); row.className = 'tree-heading'
    const items = this.state.sessions.filter((s) => s.projectId === key && (this.archived || !s.archived))
    const label = `${project?.name ?? '未归类'}${project?.archived ? '（已归档）' : ''} · ${items.length}`
    const button = this.action(label, () => this.choose(project), this.project === key ? 'group-name selected' : 'group-name')
    button.setAttribute('aria-pressed', String(this.project === key)); row.append(button)
    if (project) {
      const settings = this.action('⋯', () => this.edit('project', project), 'more')
      settings.setAttribute('aria-label', `${project.name}的项目设置`); row.append(settings)
    }
    section.append(row)
    for (const session of items) section.append(this.sessionRow(session))
    return section
  }
  sessionRow(session) {
    const line = document.createElement('div'); line.className = 'tree-session'
    const item = this.action(`${session.title}${session.archived ? '（已归档）' : ''}`, async () => {
      if (!this.callbacks.canSwitch() || this.selected === session.id) return
      await this.callbacks.open(session.id)
      document.body.classList.remove('sidebar-open')
      $('#sidebar-toggle').setAttribute('aria-expanded', 'false')
    }, this.selected === session.id ? 'session-name selected' : 'session-name')
    item.title = `${session.title} · ${session.model ?? '只读历史'}`
    item.setAttribute('aria-current', this.selected === session.id ? 'true' : 'false')
    const more = this.action('⋯', () => this.edit('session', session), 'more')
    more.setAttribute('aria-label', `${session.title}的会话设置`)
    line.append(item, more)
    return line
  }
  render() {
    $('#workspace-tree').replaceChildren(...[null, ...this.state.projects.filter((p) => this.archived || !p.archived)].map((p) => this.group(p)))
    this.heading()
    $('#new-project').disabled = this.busy
    $('#show-archived').disabled = this.busy
  }
  async refresh() {
    this.state = await api('/api/workspace/state'); this.enabled = true
    $('#workspace-status').textContent = this.state.warnings?.join('；') ?? ''
    $('#workspace-nav').hidden = false
    this.render()
  }
  async init() {
    try {
      await this.refresh()
      let saved
      try { saved = JSON.parse(localStorage.getItem('dsh-lite.selection') || '{}') } catch { saved = {} }
      this.project = this.state.projects.some((p) => p.id === saved.projectId && !p.archived) ? saved.projectId : null
      if (this.state.sessions.some((s) => s.id === saved.sessionId)) await this.callbacks.open(saved.sessionId)
      this.render()
    } catch { $('#workspace-status').textContent = '历史暂不可用；请检查工作区插件是否已加载。' }
  }
  projectId() { return this.project }
  defaultModel() { return this.state.projects.find((p) => p.id === this.project)?.model?.model }
  setBusy(value) { this.busy = value; if (this.enabled) this.render() }
  select(sessionId, project) {
    this.selected = sessionId; if (project !== undefined) this.project = project
    this.remember(); if (this.enabled) this.render()
  }
}
