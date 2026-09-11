const LABELS = { pending: '等待你确认', executing: '已确认，执行状态待核实', completed: '已完成',
  dismissed: '暂不执行', stale: '对话已有更新，请以新的建议为准', failed: '执行未完成，请继续对话后再试' }

export function createConversationActionView({ onDecide, details }) {
  const cards = new Map()
  let locked = false
  function render(parent, actions = []) {
    for (const action of actions) {
      if (cards.has(action.id)) continue
      const card = createCard(action, onDecide)
      const link = details.link(`建议操作：${action.title}`, card.element)
      const update = card.update
      card.update = (next, locked) => { update(next, locked); link.textContent = `${action.title} · ${LABELS[next.status] ?? '查看建议'}` }
      cards.set(action.id, card)
      card.update(action, locked)
      parent.append(link)
    }
  }
  return { render,
    update(actions = []) { for (const action of actions) cards.get(action.id)?.update(action, locked) },
    setBusy(value, readOnly = false) { locked = value || readOnly; for (const card of cards.values()) card.lock(locked) },
    reset() { cards.clear() },
  }
}

function createCard(action, onDecide) {
  const element = document.createElement('section')
  element.className = 'conversation-action'
  element.setAttribute('aria-label', `建议操作：${action.title}`)
  const label = document.createElement('p'), title = document.createElement('h3')
  label.className = 'action-label'; label.textContent = '建议下一步'
  title.textContent = action.title
  const reason = document.createElement('p'), effect = document.createElement('p')
  reason.textContent = action.reason; effect.textContent = action.effect; effect.className = 'action-effect'
  const state = document.createElement('p'); state.className = 'action-state'; state.setAttribute('role', 'status')
  const buttons = document.createElement('div'); buttons.className = 'action-buttons'
  const confirm = document.createElement('button'), dismiss = document.createElement('button')
  confirm.type = dismiss.type = 'button'
  confirm.className = 'action-confirm'; confirm.textContent = action.confirmLabel
  dismiss.textContent = '暂不执行'
  confirm.addEventListener('click', () => onDecide(action, 'confirm'))
  dismiss.addEventListener('click', () => onDecide(action, 'dismiss'))
  buttons.append(confirm, dismiss)
  element.append(label, title, reason, effect, state, buttons)
  let status = action.status
  function lock(value) { confirm.disabled = dismiss.disabled = value || status !== 'pending' }
  return { element, lock, update(next, locked) {
    status = next.status
    state.textContent = LABELS[status] ?? '该建议暂不可用'
    buttons.hidden = status !== 'pending'
    element.dataset.status = status
    lock(locked)
  } }
}
