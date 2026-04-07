import { escapeHtml } from './html'
import { createNoteSource, type HyperCortexNoteSource } from './noteSchema'

export type RenderNoteDisplayOptions = {
  includeTitle?: boolean
}

function renderParagraphs(body: string): string {
  const normalized = String(body || '').replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  const html = lines.map(line => `<p>${line ? escapeHtml(line) : '<br />'}</p>`).join('')
  return html || '<p><br /></p>'
}

function renderTags(tags: string[]): string {
  if (!tags.length) return ''
  return `<div class="hypercortex-note-tags">${tags
    .map(tag => `<span class="hypercortex-note-tag">${escapeHtml(tag)}</span>`)
    .join('')}</div>`
}

export function renderNoteDisplayHtml(source: HyperCortexNoteSource, options?: RenderNoteDisplayOptions): string {
  const normalized = createNoteSource(source)
  const titleHtml = options?.includeTitle ? `<h1 class="hypercortex-note-title">${escapeHtml(normalized.title)}</h1>` : ''
  const tagsHtml = renderTags(normalized.tags)
  const bodyHtml = `<div class="hypercortex-note-body">${renderParagraphs(normalized.body)}</div>`
  return `<article class="hypercortex-note-view">${titleHtml}${tagsHtml}${bodyHtml}</article>`
}
