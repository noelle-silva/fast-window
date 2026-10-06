/* ------------------------------------------------------------------ */
/*  自注入 CSS（渲染产物所需的样式，挂在 .hc-render 根下）                   */
/* ------------------------------------------------------------------ */

const ENGINE_STYLE_ID = 'hc-render-engine-css'
const ENGINE_CSS = `
.hc-render{font-size:15px;line-height:1.75;word-break:break-word;color:var(--hc-text);}
.hc-render h1{font-size:1.6em;margin:16px 0 8px;font-weight:700;}
.hc-render h2{font-size:1.35em;margin:14px 0 6px;font-weight:700;}
.hc-render h3{font-size:1.15em;margin:12px 0 4px;font-weight:600;}
.hc-render h4,.hc-render h5,.hc-render h6{font-size:1em;margin:10px 0 4px;font-weight:600;}
.hc-render p{margin:8px 0;}
.hc-render ul,.hc-render ol{margin:8px 0 8px 18px;}
.hc-render blockquote{margin:10px 0;padding:8px 12px;background:var(--hc-primary-soft);border-radius:12px;}
.hc-render hr{border:0;height:2px;background:var(--hc-surface-muted);margin:10px 0;border-radius:999px;}
.hc-render img{max-width:100%;height:auto;cursor:zoom-in;}
.hc-render table{border-collapse:collapse;width:100%;max-width:100%;overflow-x:auto;overflow-y:hidden;border-radius:12px;display:block;}
.hc-render th,.hc-render td{padding:8px;vertical-align:top;background:var(--hc-surface-soft);}
.hc-render th{background:var(--hc-surface-muted);}
.hc-render pre{overflow:auto;padding:10px;background:var(--hc-code-bg);color:var(--hc-code-text);border-radius:10px;}
.hc-render pre.fw-code-block{position:relative;padding-top:38px;white-space:pre-wrap;overflow-wrap:anywhere;overflow-x:hidden;overflow-y:auto;}
.hc-render code{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:13px;}
.hc-render pre.fw-code-block .fw-code-copy{position:absolute;top:8px;right:8px;z-index:1;width:30px;height:30px;padding:0;border:0;border-radius:999px;background:var(--hc-code-control-bg);color:var(--hc-code-text);font-size:12px;cursor:pointer;user-select:none;-webkit-user-select:none;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);display:inline-flex;align-items:center;justify-content:center;}
.hc-render pre.fw-code-block .fw-code-copy:hover{background:rgba(245,239,226,.14);}
.hc-render pre.fw-code-block .fw-code-copy:active{background:rgba(245,239,226,.18);}
.hc-render pre.fw-code-block .fw-code-copy:disabled{opacity:.75;cursor:default;}
.hc-render pre.fw-code-block .fw-code-copy:focus-visible{box-shadow:0 0 0 3px rgba(245,239,226,.22);}
.hc-render pre.fw-code-block .fw-code-copy[data-state="ok"]{color:var(--hc-success);}
.hc-render pre.fw-code-block .fw-code-copy[data-state="fail"]{color:var(--hc-danger);}
.hc-asset{display:inline-block;vertical-align:middle;}
.hc-asset-chip{display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:999px;background:var(--hc-surface-soft);color:var(--hc-text-muted);font-size:12px;line-height:1;user-select:none;}
.hc-asset-chip--loading{background:var(--hc-primary-soft);color:var(--hc-primary);}
.hc-asset-chip--error{background:var(--hc-danger-soft);color:var(--hc-danger);}
.hc-asset-chip--doc{background:var(--hc-surface-soft);color:var(--hc-text-muted);}
.hc-asset-block{margin:10px 0;display:flex;flex-direction:column;gap:6px;}
.hc-asset-title{font-size:12px;color:var(--hc-text-subtle);font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.hc-note-ref{color:var(--hc-primary);text-decoration:none;background:var(--hc-primary-soft);border-radius:8px;padding:0 3px;cursor:pointer;transition:background-color 120ms ease;}
.hc-note-ref:hover{background:var(--hc-primary-hover);}
.hc-note-ref--broken{color:var(--hc-text-subtle);text-decoration:line-through;background:var(--hc-surface-soft);cursor:default;}
.hc-note-ref--face-gone{color:var(--hc-text-subtle);text-decoration:line-through;background:var(--hc-surface-soft);cursor:pointer;}
.hc-note-ref--face-gone:hover{background:var(--hc-surface-muted);}
.hc-note-ref-badge{display:inline-flex;align-items:center;margin-left:4px;padding:0 5px;border-radius:999px;font-size:10px;line-height:1.5;font-weight:600;color:var(--hc-text-subtle);background:var(--hc-surface-muted);vertical-align:1px;user-select:none;}
.math-block{margin:10px 0;overflow-x:auto;}
.hc-render .katex,.hc-render .katex-display{max-width:100%;}
.hc-render span.katex{display:inline-block;overflow:visible;vertical-align:middle;}
.hc-render .katex-display{overflow:visible;}
.hc-render .katex-display>.katex{display:block;overflow-x:visible;}
.fw-math-host{position:relative;}
.math-inline.fw-math-host{display:inline-block;}
.math-block.fw-math-host{display:block;}
.fw-math-copy{position:absolute;width:24px;height:24px;padding:0;border:0;border-radius:999px;background:transparent;color:var(--hc-text-muted);cursor:pointer;user-select:none;-webkit-user-select:none;display:inline-flex;align-items:center;justify-content:center;font-size:12px;line-height:1;opacity:0;visibility:hidden;pointer-events:none;transition:opacity 120ms ease,background-color 120ms ease;}
.fw-math-copy:hover{background:var(--hc-surface-soft);color:var(--hc-text);}
.fw-math-copy:active{background:var(--hc-surface-muted);color:var(--hc-text);}
.fw-math-copy:focus-visible{box-shadow:0 8px 18px var(--hc-shadow);}
.math-inline.fw-math-host>.fw-math-copy{left:100%;top:50%;transform:translate(0,-50%);}
.math-block.fw-math-host>.fw-math-copy{right:6px;top:50%;transform:translateY(-50%);}
.fw-math-host:hover>.fw-math-copy,.fw-math-host:focus-within>.fw-math-copy{opacity:1;visibility:visible;pointer-events:auto;}
.mermaid-block{margin:10px 0;overflow-x:auto;cursor:zoom-in;text-align:center;}
.mermaid-block svg{max-width:100%;height:auto;display:block;margin:0 auto;}
.mermaid-error{margin:10px 0;overflow-x:auto;}
.mermaid-error-box{position:relative;background:var(--hc-surface);box-shadow:0 10px 24px var(--hc-shadow);border-radius:12px;padding:10px 12px;padding-right:48px;}
.mermaid-error-copy{position:absolute;top:8px;right:8px;width:28px;height:28px;padding:0;border:0;border-radius:999px;background:var(--hc-surface-soft);color:var(--hc-text-muted);cursor:pointer;user-select:none;-webkit-user-select:none;display:inline-flex;align-items:center;justify-content:center;font-size:12px;}
.mermaid-error-copy:hover{background:var(--hc-surface-muted);color:var(--hc-text);}
.mermaid-error-copy:active{background:var(--hc-primary-soft);}
.mermaid-error-copy:disabled{opacity:.7;cursor:default;}
.mermaid-error-copy:focus-visible{box-shadow:0 8px 18px var(--hc-shadow);}
.mermaid-error-title{font-weight:900;font-size:12px;color:var(--hc-text-muted);}
.mermaid-error-msg{margin-top:6px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:12px;color:var(--hc-text-subtle);white-space:pre-wrap;word-break:break-word;}
.mermaid-error-src{display:none;}
.mermaid-error-err{display:none;}
`

export function ensureEngineCss() {
  if (document.getElementById(ENGINE_STYLE_ID)) return
  const el = document.createElement('style')
  el.id = ENGINE_STYLE_ID
  el.textContent = ENGINE_CSS
  document.head.appendChild(el)
}
