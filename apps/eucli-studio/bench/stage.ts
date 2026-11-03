export function benchStage(): HTMLElement {
  const el = document.getElementById('bench-stage')
  if (!el) throw new Error('bench-stage 不存在')
  return el
}

export function clearStage() {
  benchStage().replaceChildren()
}

export function mountBox(width = 860): HTMLDivElement {
  const box = document.createElement('div')
  box.style.width = `${width}px`
  box.style.maxWidth = '100%'
  box.style.margin = '0 auto'
  box.style.background = '#ffffff'
  benchStage().appendChild(box)
  return box
}
