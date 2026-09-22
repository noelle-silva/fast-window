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
  const rendered = await mermaid.render(uid('mermaid-svg'), text)
  const svg = sanitizeSvg(typeof rendered === 'string' ? rendered : rendered?.svg, 'original')
  if (!svg) throw new Error('Mermaid 渲染结果为空')
  return svg
}
