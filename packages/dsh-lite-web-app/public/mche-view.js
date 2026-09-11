import { element, button, revealField } from './mche-elements.js'
import { inputPane } from './mche-inputs.js'
import { candidatePane, selectionPane, preparationPane, tubePane, catalogPane } from './mche-candidates.js'
import { finCandidatesPane, finSelectionPane, finPane, finCatalogPane } from './mche-fins.js'
import { refrigerantCandidatesPane, refrigerantSelectionPane, refrigerantPane, refrigerantCatalogPane } from './mche-refrigerants.js'
import { calculationInputsPane, nativePreparationPane, calculationResultsPane } from './mche-calculation.js'
import { requirementsPane } from './mche-requirements.js'
import { guidancePane } from './mche-guidance.js'

const views = { inputs: '选型条件', candidates: '候选比较', selection: '型号确认', conditions:'工况与结构', engineering:'工程核对', preparation: '参数准备' }
const mainViews = { requirements: '需求', components: '部件', calculation: '计算', results: '结果' }
const mainFor = view => view === 'requirements' || view === 'results' ? view : ['conditions', 'engineering', 'preparation'].includes(view) ? 'calculation' : 'components'
export function createMcheView(options) { return new McheView(options).root }

class McheView {
  constructor({ reference = {}, session, writable = () => true }) {
    Object.assign(this, { reference, session, writable, loading: false, disposed: false,
      active: reference.view ?? 'requirements', component: ['fin', 'refrigerant'].includes(reference.component) ? reference.component : ['fin', 'refrigerant'].includes(reference.view) ? reference.view : 'tube',
      boundSession: reference.sessionId, proposalId: reference.proposalId })
    this.root = element('div', '', 'mche-view'); this.notice = element('p')
    this.content = element('div', '', 'mche-body'); this.nav = element('nav', '', 'mche-subnav'); this.components = element('nav', '', 'mche-components')
    this.mainNav = element('nav', '', 'mche-mainnav'); this.mainNav.setAttribute('aria-label', 'MCHE 主导航')
    this.footer = element('div', '', 'mche-actions'); this.footer.setAttribute('aria-label', '当前操作')
    this.positions = new Map(); this.locations = {}; this.special = {}
    this.components.setAttribute('aria-label', '选择部件')
    this.notice.setAttribute('role', 'status'); this.nav.setAttribute('aria-label', 'MCHE方案详情')
    this.actions = Object.fromEntries(['request', 'run', 'mutate', 'dirty', 'navigate', 'showTube', 'showFin', 'showRefrigerant', 'showSearch', 'focusField'].map((key) => [key, this[key].bind(this)]))
    this.mount()
  }
  dirty(value) { this.root.dataset.dirty = String(value) }
  focusField(key) { this.pendingField = key }
  navigate({ view, component, proposalId }) {
    if (this.isDirty()) { this.notice.textContent = '请先保存输入草稿。'; return }
    this.remember()
    this.active = view; if (component) this.component = component
    this.proposalId = proposalId
    void this.run(() => this.request('case'))
  }
  isDirty() { return this.root.dataset.dirty === 'true' }
  updateDisabled() {
    this.root.querySelectorAll('button, input, select, textarea').forEach((item) => {
      item.disabled = this.loading || (!item.closest('nav') && item.dataset.readOnly !== 'true' && !this.writable()) || item.dataset.unavailable === 'true'
    })
  }
  mount() {
    for (const [main, label] of Object.entries(mainViews)) {
      const tab = button(label, () => this.navigate(this.locations[main] ?? { view: { requirements: 'requirements', components: 'candidates', calculation: 'conditions', results: 'results' }[main] }))
      tab.dataset.main = main; this.mainNav.append(tab)
    }
    for (const [component, label] of [['tube', '扁管'], ['fin', '翅片'], ['refrigerant', '冷媒']]) {
      const tab = button(label, () => {
        if (this.isDirty()) { this.notice.textContent = '请先保存输入草稿。'; return }
        this.navigate({ component, view: ['tube', 'fin', 'refrigerant', 'catalog'].includes(this.active) ? 'candidates' : this.active })
      })
      tab.dataset.component = component; this.components.append(tab)
    }
    for (const [view, label] of Object.entries(views)) {
      const tab = button(label, () => {
        if (this.isDirty()) { this.notice.textContent = '请先保存输入草稿。'; return }
        this.navigate({ view })
      })
      tab.dataset.view = view; this.nav.append(tab)
    }
    this.root.append(this.mainNav, this.components, this.nav, this.notice, this.content, this.footer)
    this.root.addEventListener('detail-open', () => this.open())
    this.root.addEventListener('mche-busy', () => this.updateDisabled())
    this.root.addEventListener('dispose', () => { this.disposed = true; clearTimeout(this.pollTimer); this.disposeFlow() })
  }
  open() {
    this.boundSession ??= this.session()
    if (this.isDirty()) return
    void this.run(async () => {
      const result = await this.request('case')
      this.state = result
      const name = this.special[this.active]?.[this.active]?.name ?? this.reference.name
      if (this.active === 'tube' && name) {
        this.showTube(await this.request('tube', { name })); return null
      }
      if (this.active === 'fin' && name) {
        this.showFin(await this.request('fin', { name })); return null
      }
      if (this.active === 'refrigerant' && name) {
        this.showRefrigerant(await this.request('refrigerant', { name })); return null
      }
      if (this.active === 'catalog') {
        const query = this.special[this.component + '-catalog']?.query ?? this.reference.query ?? {}
        this.showSearch(await this.request(this.component === 'refrigerant' ? 'refrigerant-search' : this.component === 'fin' ? 'fin-search' : 'search', query), query); this.state = result; return null
      }
      return result
    })
  }
  async request(path, input = {}) {
    if (!this.boundSession || this.boundSession !== this.session()) throw new Error('会话已切换，请重新打开当前方案')
    const response = await fetch(`/api/mche/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...input, sessionId: this.boundSession }) })
    const data = await response.json()
    if (!response.ok || data.ok === false) throw new Error(data.error ?? data.message ?? '方案请求失败')
    if (this.disposed || this.boundSession !== this.session()) throw new Error('会话已切换')
    return data
  }
  async run(work) {
    if (this.loading) return
    this.loading = true; this.notice.textContent = '正在读取 / 保存…'; this.updateDisabled()
    try {
      const result = await work()
      if (this.disposed) return
      if (result) {
        if (this.active === 'results' && this.reference.runId && !result.calculation.runs.some(run => run.runId === this.reference.runId)) {
          this.linkedRun = await this.request('calculation-get', { runId: this.reference.runId })
        }
        this.state = result; this.render()
        if (this.pendingField) {
          this.focusAfterRun = this.content.querySelector(`[data-field="${CSS.escape(this.pendingField)}"] :is(input,select,textarea)`)
          this.pendingField = null
        }
      }
      this.notice.textContent = '已更新。'
    } catch (error) {
      this.notice.textContent = error.message
      const matches = [...this.content.querySelectorAll('input, select, textarea')].filter(node => {
        const label = node.getAttribute('aria-label')?.replace(/采用值$|单位$|依据$/, '')
        return label && error.message.includes(label)
      })
      this.focusAfterRun = /依据|原文/.test(error.message) ? matches.find(node => node.getAttribute('aria-label').endsWith('依据')) ?? matches[0] : matches[0]
    }
    finally { this.loading = false; this.updateDisabled(); if (this.focusAfterRun) { revealField(this.focusAfterRun); this.focusAfterRun = null } }
  }
  async mutate(path, input, next = this.active) {
    if (!this.writable()) { this.notice.textContent = '请等待本轮回复完成，并清空或发送待发送内容。'; return }
    if (this.isDirty()) { this.notice.textContent = '请先保存输入草稿，再确认或比较。'; return }
    await this.run(async () => {
      const result = await this.request(path, input)
      this.active = next
      if (['propose', 'fin-propose', 'refrigerant-propose'].includes(path)) this.proposalId = result.proposals.at(-1).id
      return result
    })
  }
  showTube(record) {
    this.remember(); this.component = 'tube'; this.active = 'tube'; this.special.tube = record; this.render()
  }
  showFin(record) {
    this.remember(); this.component = 'fin'; this.active = 'fin'; this.special.fin = record; this.render()
  }
  showRefrigerant(record) {
    this.remember(); this.component = 'refrigerant'; this.active = 'refrigerant'; this.special.refrigerant = record; this.render()
  }
  showSearch(result, query) {
    this.remember(); this.active = 'catalog'; this.special[this.component + '-catalog'] = { result, query }; this.render()
  }
  updateTabs() {
    const main = mainFor(this.active)
    this.locations[main] = { view: this.active, component: this.component, proposalId: this.proposalId }
    this.mainNav.querySelectorAll('button').forEach(item => item.setAttribute('aria-current', item.dataset.main === main ? 'page' : 'false'))
    this.components.hidden = main !== 'components'; this.nav.hidden = !['components', 'calculation'].includes(main)
    this.components.querySelectorAll('button').forEach(item => item.setAttribute('aria-current', item.dataset.component === this.component ? 'page' : 'false'))
    this.nav.querySelectorAll('button').forEach(item => {
      item.hidden = mainFor(item.dataset.view) !== main
      item.setAttribute('aria-current', item.dataset.view === this.active ? 'page' : 'false')
    })
  }
  disclosureKey(node) {
    const parts = []
    for (let parent = node; parent && parent !== this.content; parent = parent.parentElement) {
      const key = parent.dataset.disclosure ?? parent.dataset.recordId ?? parent.dataset.profileField ?? parent.dataset.field
      if (key) parts.unshift(key)
      else if (parent.tagName === 'DETAILS') parts.unshift(parent.querySelector(':scope > summary')?.textContent)
    }
    return parts.join('/')
  }
  remember() {
    if (!this.renderedKey) return
    this.positions.set(this.renderedKey, { scroll: this.content.scrollTop,
      details: new Map([...this.content.querySelectorAll('details')].map(node => [this.disclosureKey(node), node.open])),
      flow: this.content.querySelector('.mche-flow')?.flowPresentation?.() })
  }
  disposeFlow() { this.content.querySelectorAll('.mche-flow').forEach(node=>node.flowDispose?.()) }
  renderPane(position) {
    const { state, active, actions, component } = this
    const byComponent = (tube, fin, refrigerant) => component === 'refrigerant' ? refrigerant : component === 'fin' ? fin : tube
    if (['tube', 'fin', 'refrigerant'].includes(active) && this.special[active]) {
      return ({ tube: tubePane, fin: finPane, refrigerant: refrigerantPane }[active])(this.special[active], actions)
    }
    if (active === 'catalog' && this.special[component + '-catalog']) {
      const { result, query } = this.special[component + '-catalog']
      return byComponent(catalogPane, finCatalogPane, refrigerantCatalogPane)(result, query, actions)
    }
    switch (active) {
      case 'requirements': return requirementsPane(state, actions)
      case 'conditions':
      case 'engineering': return calculationInputsPane(state, actions, active, position?.flow ?? { enlarged: this.reference.openEditor === true })
      case 'results': return calculationResultsPane(state, actions, this.reference.runId, this.linkedRun)
      case 'inputs': return inputPane(state, actions, component)
      case 'selection': return byComponent(selectionPane, finSelectionPane, refrigerantSelectionPane)(state, actions, this.proposalId)
      case 'preparation': return nativePreparationPane(state, actions)
      default: return byComponent(candidatePane, finCandidatesPane, refrigerantCandidatesPane)(state, actions)
    }
  }
  render() {
    this.remember()
    this.disposeFlow()
    const { state, active, actions } = this
    this.renderedKey = `${active}:${this.component}`
    const position = this.positions.get(this.renderedKey)
    const pane = this.renderPane(position)
    this.content.replaceChildren(guidancePane(state, actions, active, this.component), pane)
    const currentIssues = this.content.querySelector('.mche-current-issues')
    if (currentIssues?.childElementCount) this.content.append(currentIssues)
    this.footer.replaceChildren(...pane.querySelectorAll('[data-primary-action]'))
    this.footer.hidden = !this.footer.childElementCount
    if(active==='preparation') {const logical=element('details');logical.append(element('summary','查看原有逻辑几何准备'),preparationPane(state,actions));this.content.append(logical)}
    this.updateTabs()
    this.updateDisabled()
    for (const node of this.content.querySelectorAll('details')) {
      const saved = position?.details.get(this.disclosureKey(node))
      if (saved !== undefined && node.dataset.disclosure !== 'requirements-confirmation') node.open = saved
    }
    this.content.scrollTop = position?.scroll ?? 0
    clearTimeout(this.pollTimer)
    if(active==='results'&&state.calculation.runs.some(r=>['queued','running'].includes(r.status)))this.pollTimer=setTimeout(()=>{
      if(!this.disposed&&!this.isDirty()&&this.root.isConnected&&this.root.closest('dialog')?.open&&!this.root.closest('.detail-entry')?.hidden)void this.run(()=>this.request('case'))
    },2000)
  }
}
