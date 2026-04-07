import { type Api, type VaultScope } from './core'
import { escapeHtml } from './html'
import { createNoteSource, parseNoteSourceDocument, serializeNoteSource, type HyperCortexNoteSourceInput, type HyperCortexNoteSource } from './noteSchema'
import { renderNoteDisplayHtml } from './noteRender'

export type HyperCortexNoteDoc = HyperCortexNoteSource & {
  displayHtml: string
}

function noteDocumentStyle(): string {
  return `
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
}

function noteRuntimeScript(): string {
  return String.raw`
(function () {
  var root = document.querySelector('hypercortex-note-source');
  var target = document.getElementById('hypercortex-content');
  if (!root || !target) return;

  function textOf(selector, fallback) {
    var node = root.querySelector(selector);
    var text = node && node.textContent ? node.textContent : (fallback || '');
    return String(text || '').replace(/\r\n/g, '\n');
  }

  function escapeHtml(value) {
    return String(value || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function renderParagraphs(body) {
    var lines = String(body || '').split('\n');
    var html = lines.map(function (line) {
      return '<p>' + (line ? escapeHtml(line) : '<br />') + '</p>';
    }).join('');
    return html || '<p><br /></p>';
  }

  var title = String(textOf('note-title', '未命名')).trim() || '未命名';
  var body = textOf('note-body', '');
  var tags = Array.from(root.querySelectorAll('note-tags > note-tag'))
    .map(function (node) { return String(node.textContent || '').trim(); })
    .filter(Boolean);
  var tagsHtml = tags.length
    ? '<div class="hypercortex-note-tags">' + tags.map(function (tag) { return '<span class="hypercortex-note-tag">' + escapeHtml(tag) + '</span>'; }).join('') + '</div>'
    : '';

  document.title = title;
  target.innerHTML = '<article class="hypercortex-note-view">'
    + '<h1 class="hypercortex-note-title">' + escapeHtml(title) + '</h1>'
    + tagsHtml
    + '<div class="hypercortex-note-body">' + renderParagraphs(body) + '</div>'
    + '</article>';
})();
  `.trim()
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
${noteDocumentStyle()}
    </style>
  </head>
  <body>
    ${serializeNoteSource(source)}
    <div id="hypercortex-content"></div>
    <script>
${noteRuntimeScript()}
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
