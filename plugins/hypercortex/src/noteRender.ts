import { createNoteSource, type HyperCortexNoteSource } from './noteSchema'

export type RenderNoteDisplayOptions = {
  includeTitle?: boolean
}

export const NOTE_DOCUMENT_STYLE = `
      :root { color-scheme: light; }
      body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; line-height: 1.7; margin: 0; background: #fff; color: #111827; }
      #hypercortex-content { box-sizing: border-box; width: min(880px, calc(100vw - 32px)); margin: 0 auto; padding: 22px 0 40px; }
      .hypercortex-note-view { display: flex; flex-direction: column; gap: 14px; }
      .hypercortex-note-title { margin: 0; font-size: 30px; line-height: 1.2; font-weight: 900; color: #111; }
      .hypercortex-note-tags { display: flex; flex-wrap: wrap; gap: 8px; }
      .hypercortex-note-tag { display: inline-flex; align-items: center; min-height: 28px; padding: 0 10px; border-radius: 999px; background: rgba(0,0,0,.05); color: #374151; font-size: 12px; line-height: 1; }
      .hypercortex-note-body p { margin: 0 0 12px; }
      .hypercortex-note-body p:last-child { margin-bottom: 0; }
    `

function escapeHtmlForDisplay(value: string): string {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function normalizeBodyForDisplay(body: string): string {
  return String(body || '').replace(/\r\n/g, '\n')
}

function renderParagraphsHtml(body: string): string {
  const lines = normalizeBodyForDisplay(body).split('\n')
  const html = lines.map(line => `<p>${line ? escapeHtmlForDisplay(line) : '<br />'}</p>`).join('')
  return html || '<p><br /></p>'
}

function renderTagsHtml(tags: string[]): string {
  if (!tags.length) return ''
  return `<div class="hypercortex-note-tags">${tags
    .map(tag => `<span class="hypercortex-note-tag">${escapeHtmlForDisplay(tag)}</span>`)
    .join('')}</div>`
}

function renderDisplayHtmlFromFields(fields: { title: string; body: string; tags: string[] }, includeTitle: boolean): string {
  const titleHtml = includeTitle ? `<h1 class="hypercortex-note-title">${escapeHtmlForDisplay(fields.title)}</h1>` : ''
  const tagsHtml = renderTagsHtml(fields.tags)
  const bodyHtml = `<div class="hypercortex-note-body">${renderParagraphsHtml(fields.body)}</div>`
  return `<article class="hypercortex-note-view">${titleHtml}${tagsHtml}${bodyHtml}</article>`
}

export function renderNoteDisplayHtml(source: HyperCortexNoteSource, options?: RenderNoteDisplayOptions): string {
  const normalized = createNoteSource(source)
  return renderDisplayHtmlFromFields(
    {
      title: normalized.title,
      body: normalized.body,
      tags: normalized.tags,
    },
    options?.includeTitle === true,
  )
}

function runtimeRenderNoteFromSource() {
  var root = document.querySelector('hypercortex-note-source')
  var target = document.getElementById('hypercortex-content')
  if (!root || !target) return

  function textOf(selector, fallback) {
    var node = root.querySelector(selector)
    var text = node && node.textContent ? node.textContent : fallback || ''
    return normalizeBodyForDisplay(String(text || ''))
  }

  var title = String(textOf('note-title', '未命名')).trim() || '未命名'
  var body = textOf('note-body', '')
  var tags = Array.from(root.querySelectorAll('note-tags > note-tag'))
    .map(function (node) {
      return String(node.textContent || '').trim()
    })
    .filter(Boolean)

  document.title = title
  target.innerHTML = renderDisplayHtmlFromFields({ title: title, body: body, tags: tags }, true)
}

export function buildNoteRuntimeScript(): string {
  return [
    escapeHtmlForDisplay.toString(),
    normalizeBodyForDisplay.toString(),
    renderParagraphsHtml.toString(),
    renderTagsHtml.toString(),
    renderDisplayHtmlFromFields.toString(),
    `(${runtimeRenderNoteFromSource.toString()})();`,
  ].join('\n\n')
}
