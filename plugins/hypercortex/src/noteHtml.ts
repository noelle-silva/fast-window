import { escapeHtml } from './html'
import { NOTE_DOCUMENT_STYLE, renderNoteDisplayHtml } from './noteRender'
import type { HyperCortexNoteDoc, HyperCortexNoteDocData } from './noteSchema'

export function buildNoteHtmlView(docInput: HyperCortexNoteDoc | HyperCortexNoteDocData): string {
  const title = String(docInput?.title || '').trim() || '未命名'
  const displayHtml = renderNoteDisplayHtml(docInput, { includeTitle: true })
  const schemaVersion = Number(docInput?.schemaVersion) > 0 ? Number(docInput.schemaVersion) : 1

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="hypercortex-note-id" content="${escapeHtml(String(docInput?.id || ''))}" />
    <meta name="hypercortex-note-schema-version" content="${schemaVersion}" />
    <title>${escapeHtml(title)}</title>
    <style>
${NOTE_DOCUMENT_STYLE}
    </style>
  </head>
  <body>
    <div id="hypercortex-content">${displayHtml}</div>
  </body>
</html>`
}
