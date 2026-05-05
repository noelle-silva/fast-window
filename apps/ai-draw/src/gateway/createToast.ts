export function createToast() {
  let el: HTMLDivElement | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  function ensure() {
    if (typeof document === 'undefined') return null
    if (el && el.isConnected) return el
    el = document.createElement('div')
    el.style.position = 'fixed'
    el.style.left = '50%'
    el.style.bottom = '24px'
    el.style.transform = 'translateX(-50%)'
    el.style.maxWidth = 'min(520px, calc(100vw - 24px))'
    el.style.padding = '10px 12px'
    el.style.borderRadius = '10px'
    el.style.background = 'rgba(0,0,0,0.82)'
    el.style.color = '#fff'
    el.style.fontSize = '12px'
    el.style.lineHeight = '1.4'
    el.style.boxShadow = '0 6px 18px rgba(0,0,0,0.28)'
    el.style.zIndex = '999999'
    el.style.opacity = '0'
    el.style.transition = 'opacity 160ms ease'
    el.style.pointerEvents = 'none'
    document.body.appendChild(el)
    return el
  }

  return (message: unknown) => {
    const d = ensure()
    if (!d) return
    const text = String(message ?? '').trim()
    if (!text) return
    d.textContent = text
    d.style.opacity = '1'
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      if (d && d.isConnected) d.style.opacity = '0'
    }, 1800)
  }
}
