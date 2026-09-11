const ns = 'http://www.w3.org/2000/svg'
export function svgNode(tag, attributes = {}, text) {
  const node = document.createElementNS(ns, tag)
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value))
  if (text !== undefined) node.textContent = text
  return node
}

export function renderFlowScene(topology, { expanded, airDirection, selected, onSelect, uid }) {
  const rows = topology.rows, maxPass = Math.max(...rows.map(r => r.passes.length))
  const coreHeight = Math.max(142, maxPass * 44), stride = coreHeight + 125
  const height = expanded ? rows.length * stride + 100 : coreHeight + 210 + rows.length * 26
  const svg = svgNode('svg', { viewBox: `0 0 800 ${height}`, class: 'flow-svg', role: 'group', 'aria-label': '空气与冷媒正交流向工程示意' })
  svg.append(svgNode('title', {}, '冷媒沿扁管 X 轴；空气沿排深 Z 轴。显示代表管，不按真实尺寸比例。'))
  const defs = svgNode('defs')
  for (const [name, colors] of [['metal', ['#82939c', '#f3f6f7', '#aebbc1', '#6e838f']], ['tube', ['#a1b2ba', '#edf2f4', '#96aab5']]]) {
    const gradient = svgNode('linearGradient', { id: `${uid}-${name}`, x2: '0', y2: '1' })
    colors.forEach((color, i) => gradient.append(svgNode('stop', { offset: `${i * 100 / (colors.length - 1)}%`, 'stop-color': color })))
    defs.append(gradient)
  }
  for (const [name, color] of [['air', '#2585ba'], ['ref', '#c86c27']]) {
    const marker = svgNode('marker', { id: `${uid}-${name}-arrow`, viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 5, markerHeight: 5, orient: 'auto-start-reverse' })
    marker.append(svgNode('path', { d: 'M0 0 L10 5 L0 10 Z', fill: color })); defs.append(marker)
  }
  svg.append(defs)
  const core = svgNode('g'), air = svgNode('g', { class: 'flow-air' }), ref = svgNode('g', { class: 'flow-ref' })
  svg.append(core, air, ref)
  const anchors = new Map(), particles = [], rowPositions = []
  function flow(parent, d, kind, attributes = {}) {
    const path = svgNode('path', { d, fill: 'none', class: `flow-${kind}-path`, 'marker-end': `url(#${uid}-${kind}-arrow)`, ...attributes })
    const particle = svgNode('circle', { r: kind === 'air' ? 3 : 4, class: `flow-particle flow-${kind}-particle`, 'aria-hidden': true })
    parent.append(path, particle); particles.push({ path, particle, offset: (particles.length * 0.17) % 1 }); return path
  }
  // Draw rear rows first. Row identities never reverse with air direction.
  for (let r = rows.length - 1; r >= 0; r--) {
    const row = rows[r], x = expanded ? 210 : 175 + r * 36, y = expanded ? 100 + r * stride : 115 + (rows.length - 1 - r) * 26
    rowPositions[r] = { x, y }; const width = 350, right = x + width
    const group = svgNode('g', { class: 'flow-core', 'data-row-id': row.id })
    core.append(group)
    group.append(svgNode('path', { d: `M${x} ${y} l24 -18 h${width} v${coreHeight} l-24 18 Z`, fill: '#c4cfd4', stroke: '#8ca0ac' }),
      svgNode('rect', { x, y, width, height: coreHeight, fill: '#e1e7ea', stroke: '#839ba8' }))
    for (const hx of [x - 8, right - 8]) group.append(svgNode('rect', { x: hx, y: y - 9, width: 16, height: coreHeight + 18, rx: 8, fill: `url(#${uid}-metal)`, stroke: '#758f9f' }),
      svgNode('ellipse', { cx: hx + 8, cy: y - 6, rx: 8, ry: 4, fill: '#e9eff2', stroke: '#8199a6' }))
    group.append(svgNode('text', { x: x + 24, y: y - 28, class: 'flow-row-label' }, `第 ${r + 1} 排`))
    row.passes.forEach((pass, p) => {
      const step = coreHeight / row.passes.length, py = y + p * step + step / 2
      if (p) group.append(svgNode('path', { d: `M${x-8} ${y+p*step} h16 M${right-8} ${y+p*step} h16`, stroke: '#506d7b', 'stroke-width': 2 }))
      const highlight = selected === pass.id || selected === row.id
      group.append(svgNode('rect', { x: x + 9, y: py - step / 2 + 2, width: width - 18, height: step - 4,
        fill: highlight ? '#fff0df' : '#cfdae0', opacity: 0.9 }))
      let fin = ''
      for (let fx = x + 14; fx < right - 14; fx += 7) fin += `M${fx} ${py - 6} l3.5 12 l3.5 -12 `
      group.append(svgNode('path', { d: fin, fill: 'none', stroke: '#91a6b2', 'stroke-width': 0.8 }))
      for (const offset of [-9, 9]) group.append(svgNode('rect', { x: x + 5, y: py + offset - 2, width: width - 10, height: 4, fill: `url(#${uid}-tube)`, stroke: '#708e9e', 'stroke-width': 0.5 }))
      const leftToRight = pass.direction === 'left', start = { x: leftToRight ? x : right, y: py }, end = { x: leftToRight ? right : x, y: py }
      anchors.set(pass.id, { start, end, rowIndex: r })
      if (pass.direction) flow(ref, `M${start.x} ${py} H${end.x}`, 'ref', { 'data-pass-id': pass.id, opacity: highlight || !selected ? 1 : 0.38 })
      const target = svgNode('g', { role: 'button', tabindex: 0, 'data-target-pass': pass.id, 'aria-label': `第${r + 1}排流程${p + 1}，${pass.tubeCount ?? '待填'}根管，${pass.direction === 'left' ? '左进右出' : pass.direction === 'right' ? '右进左出' : '方向待填'}`, 'aria-pressed': highlight, class: 'flow-pass-target' })
      target.append(svgNode('rect', { x: x + 10, y: py - step / 2 + 2, width: width - 20, height: step - 4, fill: 'transparent' }))
      if (expanded || r === 0) target.append(svgNode('text', { x: x + 20, y: py - 14, class: 'flow-pass-label' }, `${r + 1}.${p + 1} · ${pass.tubeCount ?? '—'} 根`))
      const choose = () => onSelect(pass.id)
      target.addEventListener('click', choose); target.addEventListener('keydown', e => { if (['Enter', ' '].includes(e.key)) { e.preventDefault(); choose() } })
      ref.append(target)
    })
    for (let a = 0; a < 3; a++) {
      const ax = x + 85 + a * 82, ay = y + coreHeight + 37, reverse = airDirection === 'right_to_left'
      if (airDirection) flow(air, reverse ? `M${ax + 92} ${ay - 142} L${ax} ${ay}` : `M${ax} ${ay} L${ax + 92} ${ay - 142}`, 'air')
    }
  }
  const chains = topology.connection === 'series' ? [topology.order] : rows.map(r => r.passes.map(p => p.id))
  const input = { x: 84, y: 54 }, output = { x: 706, y: height - 37 }
  ref.append(svgNode('text', { x: input.x - 30, y: input.y - 13, class: 'flow-port-label' }, '冷媒总入口'), svgNode('text', { x: output.x - 65, y: output.y + 23, class: 'flow-port-label' }, '冷媒总出口'))
  let route = 0
  for (const chain of chains) {
    for (let i = 0; i <= chain.length; i++) {
      const from = i === 0 ? input : anchors.get(chain[i - 1])?.end, to = i === chain.length ? output : anchors.get(chain[i])?.start
      if (!from || !to || (i > 0 && !rows.flatMap(r => r.passes).find(p => p.id === chain[i - 1])?.direction) || (i < chain.length && !rows.flatMap(r => r.passes).find(p => p.id === chain[i])?.direction)) continue
      const lane = 50 + (route++ % 12) * 7, leftLane = lane, rightLane = 750 - lane / 2
      const fromLane = from.x < 400 ? leftLane : rightLane, toLane = to.x < 400 ? leftLane : rightLane
      const bridgeY = 32 + (route % 10) * 4
      const d = fromLane === toLane ? `M${from.x} ${from.y} H${fromLane} V${to.y} H${to.x}` :
        `M${from.x} ${from.y} H${fromLane} V${bridgeY} H${toLane} V${to.y} H${to.x}`
      // White casing keeps external pipes readable over projected metal cores.
      ref.append(svgNode('path', { d, class: 'flow-pipe-casing', fill: 'none' }))
      const related = !selected || [chain[i - 1], chain[i]].some(id => id === selected || rows.find(r => r.id === selected)?.passes.some(p => p.id === id))
      flow(ref, d, 'ref', { class: 'flow-ref-path flow-connection', opacity: related ? 1 : 0.3, 'data-from': i === 0 ? 'inlet' : chain[i - 1], 'data-to': i === chain.length ? 'outlet' : chain[i] })
    }
  }
  const airOrder = rows.map((_, i) => i + 1); if (airDirection === 'right_to_left') airOrder.reverse()
  svg.append(svgNode('text', { x: 80, y: height - 9, class: 'flow-air-label' }, airDirection ? `空气入口 → 排 ${airOrder.join(' → 排 ')} → 空气出口（Z轴）` : '空气方向待填'))
  return { svg, particles }
}
