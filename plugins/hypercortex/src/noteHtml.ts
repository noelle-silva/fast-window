import { type Api, type VaultScope } from './core'
import { escapeHtml } from './html'
import { createNoteSource, parseNoteSourceDocument, serializeNoteSource, type HyperCortexNoteSourceInput, type HyperCortexNoteSource } from './noteSchema'
import { buildNoteRuntimeScript, NOTE_DOCUMENT_STYLE, renderNoteDisplayHtml } from './noteRender'

export type HyperCortexNoteDoc = HyperCortexNoteSource & {
  displayHtml: string
}

export function buildNoteHtmlDoc(meta: { id: string; source: HyperCortexNoteSourceInput }): string {
  const source = createNoteSource(meta.source)
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="hypercortex-note-id" content="${escapeHtml(meta.id)}" />
    <title>${escapeHtml(source.title)}</title>
    <style>
${NOTE_DOCUMENT_STYLE}
    </style>
  </head>
  <body>
    ${serializeNoteSource(source)}
    <div id="hypercortex-content"></div>
    <script>
${buildNoteRuntimeScript()}
    </script>
  </body>
</html>`
}

export async function readNoteDoc(api: Api, scope: VaultScope, file: string): Promise<HyperCortexNoteDoc> {
  const raw = await api.files.readText({ scope, path: file })
  const doc = new DOMParser().parseFromString(raw, 'text/html')
  const source = parseNoteSourceDocument(doc)
  return {
    ...source,
    displayHtml: renderNoteDisplayHtml(source),
  }
}
