import { element, button, message } from './mche-elements.js'
import { createFlowAnimation } from './flow-animation.js'
import { renderFlowScene } from './flow-scene.js'

export function createFlowTopologyEditor(calc, actions, presentation = {}) {
  const topology = structuredClone(calc.topology), root = element('section', '', 'mche-flow')
  const uid = 'flow-' + crypto.randomUUID(), header = element('div', '', 'flow-heading'), state = element('span', '已保存', 'flow-save-state')
  const toolbar = element('div', '', 'flow-toolbar'), stage = element('div', '', 'flow-stage'), selection = message('选择排或流程，核对方向与实际管数。')
  const editor = element('div', '', 'flow-editor'), basis = element('textarea'), orderBox = element('details'), orderGrid = element('div', '', 'flow-order')
  let dirty = false, selected = presentation.selected ?? null, expanded = presentation.expanded ?? false, airDirection = calc.draft.airDirection?.value ?? ''
  const controller = createFlowAnimation(root, stage); root.flowController = controller; root.flowDispose = () => controller.dispose()
  const readButton = (label, fn) => { const b = button(label, fn); b.dataset.readOnly = 'true'; return b }
  function select(id) { selected = id; draw(); renderSelection() }
  function renderSelection() {
    const parts = []
    topology.rows.forEach((r, i) => r.passes.forEach((p, j) => {
      if (p.id === selected || r.id === selected) parts.push(`第${i + 1}排流程${j + 1}：${p.tubeCount ?? '待填'}根，${p.direction === 'left' ? '左进右出' : p.direction === 'right' ? '右进左出' : '方向待填'}`)
    }))
    selection.textContent = parts.join('；') || '选择排或流程，核对方向与实际管数。'
    root.querySelectorAll('[data-select-pass]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.selectPass === selected)))
  }
  function draw() {
    const focused = stage.contains(document.activeElement) ? document.activeElement?.dataset.targetPass : null
    const result = renderFlowScene(topology, { expanded, airDirection, selected, onSelect: select, uid })
    stage.replaceChildren(result.svg); controller.setPaths(result.particles)
    if (focused) stage.querySelector(`[data-target-pass="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true })
    root.dataset.connection = topology.connection
  }
  function mark() { dirty = true; state.textContent = '未保存 · 本地预览'; root.dataset.unsaved = 'true'; actions.dirty(true); draw(); renderSelection() }
  function canonical() { return topology.rows.flatMap(r => r.passes.map(p => p.id)) }
  function syncOrder() {
    const ids = canonical()
    topology.order = topology.connection === 'parallel' ? ids : [...topology.order.filter(id => ids.includes(id)), ...ids.filter(id => !topology.order.includes(id))]
  }
  function labeled(label, input) { const item = element('label'); item.append(element('span', label), input); input.setAttribute('aria-label', label); return item }
  function selectControl(label, choices, value, change) {
    const input = element('select'); for (const [v, name] of choices) input.add(new Option(name, String(v)))
    input.value = String(value); input.addEventListener('change', () => change(input.value)); return labeled(label, input)
  }
  header.append(element('h3', '流向与芯体结构'), state)
  const play = readButton(controller.state.wanted ? '暂停' : '播放', () => { controller.toggle(); playbackText() })
  function playbackText() { play.textContent = controller.state.reduced ? '系统已减少动态' : controller.state.wanted ? '暂停' : '播放'; play.dataset.unavailable = String(controller.state.reduced); play.disabled = controller.state.reduced }
  root.addEventListener('flow-playback', playbackText); playbackText()
  const expand = readButton('展开各排', () => { expanded = !expanded; expand.textContent = expanded ? '整体视图' : '展开各排'; draw() })
  const enlarge = readButton('放大查看', () => { root.classList.toggle('flow-enlarged'); enlargeText(); stage.focus({ preventScroll: true }) })
  const advanced = element('div', '', 'flow-advanced')
  function enlargeText() { const full = root.classList.contains('flow-enlarged'); enlarge.textContent = full ? '收起放大' : '放大查看'; enlarge.setAttribute('aria-expanded', String(full)); advanced.hidden = !full }
  root.classList.toggle('flow-enlarged', presentation.enlarged === true); enlargeText()
  stage.tabIndex = 0; stage.setAttribute('aria-label', '结构图，可横向滚动')
  const speed = selectControl('播放速度', [[0.5, '0.5×'], [1, '1×'], [2, '2×']], 1, v => controller.speed(Number(v)))
  speed.querySelector('select').dataset.readOnly = 'true'
  toolbar.append(play, enlarge, advanced); advanced.append(speed, expand)
  expand.textContent = expanded ? '整体视图' : '展开各排'
  if (presentation.speed) { speed.querySelector('select').value = String(presentation.speed); controller.speed(presentation.speed) }
  if (presentation.wanted !== undefined && presentation.wanted !== controller.state.wanted) { controller.toggle(); playbackText() }
  for (const [key, label] of [['air', '空气'], ['ref', '冷媒']]) {
    const input = element('input'); input.type = 'checkbox'; input.checked = true; input.dataset.readOnly = 'true'
    input.checked = presentation[key] !== false; root.classList.toggle('flow-hide-' + key, !input.checked)
    input.addEventListener('change', () => root.classList.toggle('flow-hide-' + key, !input.checked)); advanced.append(labeled('显示' + label, input))
  }
  const legend = element('div', '', 'flow-legend'); legend.append(element('span', '↗ 空气 · Z轴', 'flow-air-key'), element('span', '→ 冷媒 · 扁管X轴', 'flow-ref-key'))
  const note = element('details'); note.append(element('summary', '方向示意'), message('非真实流速或温度结果。每流程绘制代表管，实际管数以下方记录为准。排号固定，反转空气只改变经过顺序。图内可左右滚动，展开后可上下查看各排。'))
  root.append(header, toolbar, legend, stage, selection, note, editor)
  root.flowPresentation = () => ({ enlarged: root.classList.contains('flow-enlarged'), expanded, selected, speed: Number(speed.querySelector('select').value), wanted: controller.state.wanted,
    air: !root.classList.contains('flow-hide-air'), ref: !root.classList.contains('flow-hide-ref') })
  const rowControl = selectControl('排数', Array.from({ length: 5 }, (_, i) => [i + 1, `${i + 1} 排`]), topology.rows.length, v => {
    const n = Number(v)
    while (topology.rows.length < n) { const id = 'r' + crypto.randomUUID().slice(0, 8); topology.rows.push({ id, passes: [{ id: id + 'p1', tubeCount: null, direction: null }] }) }
    topology.rows.length = n; syncOrder(); renderRows(); renderOrder(); mark()
  })
  const connection = selectControl('排间连接', [['series', '串联'], ['parallel', '排间并联']], topology.connection, v => {
    topology.connection = v; syncOrder(); renderOrder(); mark()
  })
  const rowsBox = element('div', '', 'flow-rows'), general = element('div', '', 'flow-structure-controls')
  general.append(rowControl, connection); editor.append(element('h4', '结构参数'), general, rowsBox)
  function renderRows() {
    rowsBox.replaceChildren()
    topology.rows.forEach((row, i) => {
      const card = element('fieldset'), title = element('legend', `第 ${i + 1} 排`), total = element('span', '', 'flow-row-total')
      const updateTotal = () => { total.textContent = row.passes.some(p => p.tubeCount === null) ? '合计待填' : `合计 ${row.passes.reduce((n, p) => n + p.tubeCount, 0)} 根`; total.classList.toggle('flow-invalid', row.passes.reduce((n, p) => n + (p.tubeCount ?? 0), 0) > 500) }
      updateTotal(); card.append(title, total, selectControl(`第${i + 1}排流程数`, Array.from({ length: 6 }, (_, p) => [p + 1, `${p + 1} 流程`]), row.passes.length, v => {
        while (row.passes.length < Number(v)) row.passes.push({ id: 'p' + crypto.randomUUID().slice(0, 8), tubeCount: null, direction: null })
        row.passes.length = Number(v); syncOrder(); renderRows(); renderOrder(); mark()
      }), readButton(`高亮第${i + 1}排`, () => select(row.id)))
      row.passes.forEach((pass, j) => {
        const line = element('div', '', 'flow-pass-editor'), pick = readButton(`${i + 1}.${j + 1}`, () => select(pass.id)), count = element('input')
        pick.dataset.selectPass = pass.id; pick.setAttribute('aria-label', `选择第${i + 1}排流程${j + 1}`)
        count.type = 'number'; count.min = '1'; count.max = '500'; count.step = '1'; count.value = pass.tubeCount ?? ''; count.placeholder = '待填'
        count.addEventListener('input', () => { pass.tubeCount = count.value === '' ? null : Number(count.value); updateTotal(); mark() })
        line.append(pick, labeled(`第${i + 1}排流程${j + 1}管数`, count), selectControl(`第${i + 1}排流程${j + 1}方向`, [['', '方向待填'], ['left', '左进 → 右出'], ['right', '右进 → 左出']], pass.direction ?? '', v => { pass.direction = v || null; mark() }))
        card.append(line)
      })
      rowsBox.append(card)
    })
  }
  orderBox.append(element('summary', '串联经过顺序'), orderGrid)
  function renderOrder() {
    orderBox.hidden = topology.connection !== 'series'; orderGrid.replaceChildren()
    const labels = new Map(topology.rows.flatMap((r, i) => r.passes.map((p, j) => [p.id, `排${i + 1} · 流程${j + 1}`])))
    const presets = element('div', '', 'flow-order-presets')
    presets.append(button('逐排串联', () => { topology.order = canonical(); renderOrder(); mark() }), button('跨排交替串联', () => {
      topology.order = Array.from({ length: Math.max(...topology.rows.map(r => r.passes.length)) }, (_, i) => topology.rows.flatMap(r => r.passes[i] ? [r.passes[i].id] : [])).flat()
      renderOrder(); mark()
    })); orderGrid.append(presets)
    topology.order.forEach((id, i) => orderGrid.append(selectControl(`经过位置${i + 1}`, [...labels], id, v => {
      const other = topology.order.indexOf(v); [topology.order[i], topology.order[other]] = [topology.order[other], topology.order[i]]
      renderOrder(); mark()
    })))
  }
  basis.value = topology.source; basis.maxLength = 1200; basis.placeholder = '用户原文、图纸编号或结构依据'
  basis.addEventListener('input', () => { topology.source = basis.value; mark() })
  editor.append(orderBox, labeled('结构来源依据', basis), message('每排合计最多500根。各排共用扁管、翅片型号。实际执行支持与待核对项见当前状态。'))
  renderRows(); renderOrder(); draw()
  return { root, get dirty() { return dirty }, get value() { return structuredClone(topology) },
    setAirDirection(value) { airDirection = value; mark() } }
}
