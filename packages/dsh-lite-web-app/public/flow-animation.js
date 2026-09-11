// Presentation clock only. Never writes engineering state or represents real velocity.
export function createFlowAnimation(root, viewport = root) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)')
  let wanted = !reduced.matches, speed = 1, frame = null, last = null, phase = 0
  let paths = [], mounted = false, disposed = false, intersecting = true, frames = 0
  const visible = () => root.isConnected && !document.hidden && intersecting && !root.closest('[hidden]') &&
    (!root.closest('dialog') || root.closest('dialog').open)
  function stop() { if (frame !== null) cancelAnimationFrame(frame); frame = null; last = null; root.dataset.playing = 'false' }
  function tick(time) {
    frame = null
    if (disposed || !wanted || reduced.matches || !visible()) { stop(); return }
    if (last !== null) phase += Math.min(time - last, 50) * speed / 5000
    last = time; frames++
    for (const { particle, points, offset } of paths) {
      const sample = ((phase + offset) % 1) * (points.length - 1), i = Math.floor(sample), f = sample - i
      const a = points[i], b = points[Math.min(i + 1, points.length - 1)]
      particle.setAttribute('transform', `translate(${a.x + (b.x - a.x) * f} ${a.y + (b.y - a.y) * f})`)
    }
    frame = requestAnimationFrame(tick)
  }
  function reconcile() {
    if (disposed) return
    if (root.isConnected) mounted = true
    else if (mounted) { dispose(); return }
    if (wanted && !reduced.matches && visible()) {
      root.dataset.playing = 'true'
      if (frame === null) frame = requestAnimationFrame(tick)
    } else stop()
  }
  const observer = new MutationObserver(reconcile)
  observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'open'] })
  const intersection = new IntersectionObserver(entries => { intersecting = entries[0]?.isIntersecting ?? false; reconcile() })
  intersection.observe(viewport)
  const preference = () => { root.dataset.reducedMotion = String(reduced.matches); reconcile(); root.dispatchEvent(new Event('flow-playback')) }
  document.addEventListener('visibilitychange', reconcile); reduced.addEventListener('change', preference)
  function dispose() {
    if (disposed) return
    disposed = true; stop(); paths = []; observer.disconnect(); intersection.disconnect()
    document.removeEventListener('visibilitychange', reconcile); reduced.removeEventListener('change', preference)
  }
  const api = {
    setPaths(items) {
      paths = items.map(({ path, particle, offset = 0 }) => {
        const length = path.getTotalLength(), count = Math.max(2, Math.ceil(length / 4))
        return { particle, offset, points: Array.from({ length: count + 1 }, (_, i) => path.getPointAtLength(length * i / count)) }
      })
      reconcile()
    },
    toggle() { wanted = !wanted; reconcile(); return wanted },
    speed(value) { speed = value }, dispose,
    get state() { return { wanted, running: frame !== null, reduced: reduced.matches, disposed, frames, paths: paths.length } },
  }
  root.dataset.reducedMotion = String(reduced.matches)
  queueMicrotask(reconcile)
  return api
}
