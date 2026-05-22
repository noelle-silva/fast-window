import mammoth from 'mammoth'
import { sanitizeDocumentHtml } from './documentHtml'

export type DocxRenderResult = {
  html: string
  textLines: string[]
  imageCount: number
  tableCount: number
  warnings: number
}

export async function renderDocxArrayBufferToHtml(arrayBuffer: ArrayBuffer): Promise<DocxRenderResult> {
  const result = await mammoth.convertToHtml({ arrayBuffer })
  const html = sanitizeDocumentHtml(result.value || '<p>这个 Word 文档没有可显示的正文。</p>')
  const summary = summarizeDocumentHtml(html)
  return {
    html,
    textLines: summary.textLines,
    imageCount: summary.imageCount,
    tableCount: summary.tableCount,
    warnings: Array.isArray(result.messages) ? result.messages.length : 0,
  }
}

export function createDocxPreviewDocumentHtml(bodyHtml: string): string {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    :root { color-scheme: light; }
    body {
      margin: 0;
      padding: 40px 48px;
      background: #f5f1e8;
      color: #151515;
      font: 16px/1.72 Georgia, 'Times New Roman', serif;
    }
    main {
      box-sizing: border-box;
      max-width: 860px;
      min-height: calc(100vh - 80px);
      margin: 0 auto;
      padding: 56px 64px;
      background: #fffdf8;
      border-radius: 18px;
      box-shadow: 0 18px 54px rgba(57, 45, 26, .14);
    }
    h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.45em 0 .55em; font-family: ui-serif, Georgia, serif; }
    h1:first-child, h2:first-child, h3:first-child { margin-top: 0; }
    p { margin: 0 0 1em; }
    img { max-width: 100%; height: auto; }
    table { width: 100%; border-collapse: separate; border-spacing: 0 6px; margin: 1em 0; }
    td, th { background: rgba(67,50,24,.055); padding: 7px 10px; vertical-align: top; }
    th { background: rgba(67,50,24,.10); font-weight: 700; }
    a { color: #6f8f72; }
    @media (max-width: 720px) {
      body { padding: 14px; font-size: 15px; }
      main { min-height: calc(100vh - 28px); padding: 28px 22px; border-radius: 14px; }
    }
  </style>
</head>
<body>
  <main>${bodyHtml}</main>
</body>
</html>`
}

export function createDocxThumbnailDataUrl(result: Pick<DocxRenderResult, 'html' | 'textLines' | 'imageCount' | 'tableCount' | 'warnings'>, title: string, width = 320, height = 180): string {
  const safeWidth = clampDimension(width, 320)
  const safeHeight = clampDimension(height, 180)
  const pageWidth = Math.round(safeWidth * 0.68)
  const pageHeight = Math.round(safeHeight * 1.62)
  const pageX = Math.round((safeWidth - pageWidth) / 2)
  const pageY = 12
  const titleText = escapeXml(title || 'Word 文档')
  const diagnostics = thumbnailDiagnostics(result)
  const body = createDocxThumbnailPageXhtml(result, title || 'Word 文档')
  const meta = diagnostics ? `<text x="${pageX + 22}" y="${pageY + pageHeight - 18}" font-family="Inter, Microsoft YaHei, sans-serif" font-size="8" font-weight="800" fill="#64748b">${escapeXml(diagnostics)}</text>` : ''
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${safeWidth}" height="${safeHeight}" viewBox="0 0 ${safeWidth} ${safeHeight}" role="img" aria-label="${titleText} Word 内容缩略图">
  <defs>
    <filter id="paperShadow" x="-25%" y="-25%" width="150%" height="150%"><feDropShadow dx="0" dy="12" stdDeviation="10" flood-color="#172033" flood-opacity="0.22"/></filter>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ece8df"/><stop offset="1" stop-color="#f8f5ef"/></linearGradient>
  </defs>
  <rect width="${safeWidth}" height="${safeHeight}" rx="18" fill="url(#bg)"/>
  <rect x="${pageX}" y="${pageY}" width="${pageWidth}" height="${pageHeight}" rx="6" fill="#fffdf8" filter="url(#paperShadow)"/>
  <foreignObject x="${pageX}" y="${pageY}" width="${pageWidth}" height="${pageHeight}">
    ${body}
  </foreignObject>
  ${meta}
</svg>`
  assertValidSvg(svg)
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function summarizeDocumentHtml(html: string): Pick<DocxRenderResult, 'textLines' | 'imageCount' | 'tableCount'> {
  if (typeof document === 'undefined') {
    return { textLines: splitReadableLines(stripHtml(html)), imageCount: 0, tableCount: 0 }
  }
  const root = document.createElement('div')
  root.innerHTML = html
  const imageCount = root.querySelectorAll('img').length
  const tableCount = root.querySelectorAll('table').length
  const blockSelector = 'h1,h2,h3,h4,h5,h6,p,li,td,th,blockquote,pre'
  const blocks = Array.from(root.querySelectorAll<HTMLElement>(blockSelector))
  const rawLines = blocks.length
    ? blocks.map(node => node.innerText || node.textContent || '')
    : [root.innerText || root.textContent || '']
  return { textLines: splitReadableLines(rawLines.join('\n')), imageCount, tableCount }
}

function splitReadableLines(value: string): string[] {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .split(/[\r\n]+/)
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 32)
}

function stripHtml(html: string): string {
  return String(html || '').replace(/<[^>]*>/g, '\n')
}

function thumbnailDiagnostics(result: Pick<DocxRenderResult, 'imageCount' | 'tableCount' | 'warnings'>): string {
  const parts: string[] = []
  if (result.imageCount) parts.push(`${result.imageCount} 图`)
  if (result.tableCount) parts.push(`${result.tableCount} 表`)
  if (result.warnings) parts.push(`${result.warnings} 提醒`)
  return parts.join(' · ')
}

function createDocxThumbnailPageXhtml(result: Pick<DocxRenderResult, 'html' | 'textLines'>, title: string): string {
  const bodyHtml = String(result.html || '').trim() || (result.textLines.length ? richPreviewHtmlFromLines(result.textLines) : `<p>${escapeXml(title)}</p><p>文档没有可提取的正文预览。</p>`)
  if (typeof document === 'undefined' || typeof XMLSerializer === 'undefined') {
    return `<div xmlns="http://www.w3.org/1999/xhtml" class="docx-thumb-page">${bodyHtml}</div>`
  }
  const page = document.createElement('div')
  page.className = 'docx-thumb-page'
  page.innerHTML = `${docxThumbnailStyle()}${bodyHtml}`
  normalizeThumbnailDom(page)
  return new XMLSerializer().serializeToString(page)
}

function richPreviewHtmlFromLines(lines: string[]): string {
  const visible = lines.map(line => line.trim()).filter(Boolean).slice(0, 14)
  if (!visible.length) return '<p>文档没有可提取的正文预览。</p>'
  const [first, ...rest] = visible
  return `<h1>${escapeXml(first)}</h1>${rest.map(line => `<p>${escapeXml(line)}</p>`).join('')}`
}

function docxThumbnailStyle(): string {
  return `<style>
    .docx-thumb-page { box-sizing: border-box; width: 100%; min-height: 100%; overflow: hidden; padding: 18px 20px; background: #fffdf8; color: #151515; font: 8.4px/1.45 Georgia, 'Times New Roman', serif; }
    .docx-thumb-page::before { content: ''; display: block; width: 100%; height: 6px; border-radius: 999px; background: #2563eb; margin-bottom: 10px; }
    .docx-thumb-page h1, .docx-thumb-page h2, .docx-thumb-page h3, .docx-thumb-page h4 { margin: 0 0 .45em; line-height: 1.18; font-family: Georgia, 'Times New Roman', serif; color: #111827; }
    .docx-thumb-page h1 { font-size: 15px; }
    .docx-thumb-page h2 { font-size: 12px; }
    .docx-thumb-page h3 { font-size: 10.5px; }
    .docx-thumb-page p { margin: 0 0 .58em; font-weight: 700; color: #334155; }
    .docx-thumb-page img { max-width: 100%; height: auto; }
    .docx-thumb-page table { width: 100%; border-collapse: collapse; margin: .6em 0; }
    .docx-thumb-page td, .docx-thumb-page th { border: .5px solid #d6d3cb; padding: 2px 3px; vertical-align: top; }
  </style>`
}

function normalizeThumbnailDom(root: HTMLElement): void {
  root.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml')
  root.querySelectorAll('script,iframe,object,embed,video,audio,canvas,svg').forEach(node => node.remove())
  root.querySelectorAll('*').forEach(node => {
    Array.from(node.attributes).forEach(attr => {
      const name = attr.name.toLowerCase()
      if (name.startsWith('on') || name === 'srcset') node.removeAttribute(attr.name)
    })
  })
  root.querySelectorAll('img').forEach((img, index) => {
    const src = img.getAttribute('src') || ''
    if (!src.startsWith('data:image/')) {
      const marker = document.createElement('p')
      marker.textContent = `图像 ${index + 1} 未内嵌，缩略图中省略。`
      img.replaceWith(marker)
    }
  })
}

function assertValidSvg(svg: string): void {
  if (typeof DOMParser === 'undefined') return
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
  const error = doc.querySelector('parsererror')
  if (error) {
    throw new Error(`DOCX 缩略图 SVG 结构无效：${(error.textContent || '').trim().slice(0, 240)}`)
  }
}

function clampDimension(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallback
  return Math.max(64, Math.min(1920, Math.round(value)))
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
