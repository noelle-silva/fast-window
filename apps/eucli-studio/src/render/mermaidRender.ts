import { uid } from '../core/utils'
import { sanitizeSvg } from './sanitize'

const MERMAID_FONT_FAMILY =
  'system-ui,-apple-system,"Segoe UI","Microsoft YaHei","PingFang SC","Noto Sans CJK SC",Roboto,Arial,sans-serif'

export async function renderMermaidSvg(source: string): Promise<string> {
  const text = String(source || '').trim()
  if (!text) throw new Error('图表内容为空')
  const mermaid = (window as any)?.mermaid
  if (!mermaid || typeof mermaid.render !== 'function') throw new Error('Mermaid 渲染器未就绪')
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'loose',
    theme: 'default',
    themeVariables: { fontFamily: MERMAID_FONT_FAMILY },
    flowchart: { htmlLabels: false },
  })

  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  host.style.position = 'fixed'
  host.style.left = '-100000px'
  host.style.top = '0'
  host.style.width = '1000px'
  host.style.height = '1000px'
  host.style.overflow = 'hidden'
  host.style.visibility = 'hidden'
  host.style.pointerEvents = 'none'
  document.body.appendChild(host)

  try {
    const rendered = await mermaid.render(uid('mermaid-svg'), text, host)
    const svg = sanitizeSvg(typeof rendered === 'string' ? rendered : rendered?.svg, 'original')
    if (!svg) throw new Error('Mermaid 渲染结果为空')
    return svg
  } finally {
    host.remove()
  }
}
