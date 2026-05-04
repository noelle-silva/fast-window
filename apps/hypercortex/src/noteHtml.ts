import { escapeHtml } from './html'
import { NOTE_DOCUMENT_STYLE } from './noteRender'

export function buildEmptyHtmlViewDoc(input?: { title?: string; noteId?: string; schemaVersion?: number }): string {
  const title = String(input?.title || '').trim() || '未命名'
  const noteId = String(input?.noteId || '').trim()
  const schemaVersion = Number(input?.schemaVersion) > 0 ? Number(input?.schemaVersion) : 1

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="hypercortex-note-id" content="${escapeHtml(noteId)}" />
    <meta name="hypercortex-note-schema-version" content="${schemaVersion}" />
    <title>${escapeHtml(title)}</title>
    <style>
${NOTE_DOCUMENT_STYLE}
    </style>
  </head>
  <body>
    <div id="hypercortex-content"></div>
  </body>
</html>`
}

export function normalizeHtmlViewContent(html: string): string {
  return String(html || '').replace(/\r\n/g, '\n')
}
