import { getApi } from './core'

function renderUiSkeleton(opts: { title: string; message: string; detail?: string }) {
  if (typeof document === 'undefined') return

  const host = document.getElementById('app') || document.body
  if (!host) return

  while (host.firstChild) host.removeChild(host.firstChild)

  const box = document.createElement('div')
  box.style.padding = '16px'
  box.style.fontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif'
  box.style.fontSize = '13px'
  box.style.lineHeight = '1.6'
  box.style.color = '#111827'

  const h = document.createElement('div')
  h.textContent = opts.title
  h.style.fontWeight = '800'
  h.style.fontSize = '14px'

  const p = document.createElement('div')
  p.textContent = opts.message
  p.style.marginTop = '6px'
  p.style.color = '#4b5563'

  box.appendChild(h)
  box.appendChild(p)

  const detail = String(opts.detail || '').trim()
  if (detail) {
    const pre = document.createElement('pre')
    pre.textContent = detail
    pre.style.marginTop = '10px'
    pre.style.padding = '10px 12px'
    pre.style.borderRadius = '10px'
    pre.style.background = '#111827'
    pre.style.color = '#e5e7eb'
    pre.style.overflow = 'auto'
    pre.style.fontSize = '12px'
    pre.style.whiteSpace = 'pre-wrap'
    box.appendChild(pre)
  }

  host.appendChild(box)
}

;(function bootstrap() {
  const runtime = String((window as any)?.fastWindow?.__meta?.runtime || 'ui')
  if (runtime === 'background') return

  try {
    void getApi()
    renderUiSkeleton({ title: 'HyperCortex', message: 'UI 已清空，等待你下一步指挥。' })
  } catch (e: any) {
    renderUiSkeleton({
      title: 'HyperCortex',
      message: 'UI 已清空（但宿主 API 不可用）。等待你下一步指挥。',
      detail: String(e?.message || e),
    })
  }
})()

