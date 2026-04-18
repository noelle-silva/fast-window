/** 块编辑器样式（自注入，不依赖外部 CSS 文件） */

const STYLE_ID = 'hc-block-editor-css'

const CSS = `
/* 编辑器容器 */
.hc-block-editor-container {
  width: 100%;
  font-size: 16px;
  line-height: 1.8;
  color: #222;
}

/* 渲染态块：可点击进入编辑 */
.hc-block-rendered {
  cursor: text;
  border-radius: 4px;
  transition: background 150ms ease;
}
.hc-block-rendered:hover {
  background: rgba(0, 0, 0, 0.02);
}

/* 空块占位 */
.hc-block-empty {
  min-height: 28px;
  display: flex;
  align-items: center;
}
.hc-block-placeholder {
  color: rgba(0, 0, 0, 0.42);
  pointer-events: none;
  user-select: none;
}

/* 编辑态 textarea */
.hc-block-editor {
  display: block;
  width: 100%;
  border: none;
  outline: none;
  resize: none;
  padding: 0;
  margin: 0;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
  font-size: 16px;
  line-height: 1.8;
  color: #222;
  background: transparent;
  overflow: hidden;
  caret-color: #1976d2;
}
.hc-block-editor::placeholder {
  color: rgba(0, 0, 0, 0.42);
}
`

export function ensureBlockEditorStyles() {
  if (document.getElementById(STYLE_ID)) return
  const el = document.createElement('style')
  el.id = STYLE_ID
  el.textContent = CSS
  document.head.appendChild(el)
}

const UNIFIED_STYLE_ID = 'hc-unified-editor-css'

const UNIFIED_CSS = `
/* 容器 */
.hc-unified-editor-container {
  position: relative;
  width: 100%;
}

.hc-unified-editor {
  width: 100%;
  outline: none;
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif;
  font-size: 16px;
  line-height: 1.8;
  color: #222;
  word-break: break-word;
  white-space: pre-wrap;
  overflow-wrap: break-word;
  caret-color: #1976d2;
  min-height: inherit;
}

.hc-line {
  min-height: 1.8em;
}

/* 标题 */
.hc-line--h1 { font-size: 1.6em; font-weight: 700; margin: 4px 0; }
.hc-line--h2 { font-size: 1.35em; font-weight: 700; margin: 2px 0; }
.hc-line--h3 { font-size: 1.15em; font-weight: 600; margin: 2px 0; }
.hc-line--h4, .hc-line--h5, .hc-line--h6 { font-size: 1em; font-weight: 600; }

/* 代码块 */
.hc-line--fence-open,
.hc-line--fence-body,
.hc-line--fence-close {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 13px;
  line-height: 1.6;
  background: #0b1220;
  color: #e5e7eb;
  padding: 0 10px;
}
.hc-line--fence-open  { border-radius: 10px 10px 0 0; padding-top: 6px; }
.hc-line--fence-close { border-radius: 0 0 10px 10px; padding-bottom: 6px; }

/* 引用 */
.hc-line--blockquote {
  padding-left: 12px;
  border-left: 4px solid rgba(25, 118, 210, 0.35);
  background: rgba(25, 118, 210, 0.06);
  color: #555;
}

/* 列表 */
.hc-line--ul, .hc-line--ol { padding-left: 18px; }

/* 水平线 */
.hc-line--hr { color: rgba(0, 0, 0, 0.38); }

/* 表格 */
.hc-line--table {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 14px;
}

/* Placeholder */
.hc-unified-placeholder {
  position: absolute;
  top: 0;
  left: 0;
  color: rgba(0, 0, 0, 0.42);
  pointer-events: none;
  user-select: none;
  font-size: 16px;
  line-height: 1.8;
}
`

export function ensureUnifiedEditorStyles() {
  if (document.getElementById(UNIFIED_STYLE_ID)) return
  const el = document.createElement('style')
  el.id = UNIFIED_STYLE_ID
  el.textContent = UNIFIED_CSS
  document.head.appendChild(el)
}

const OVERLAY_STYLE_ID = 'hc-render-overlay-css'

const OVERLAY_CSS = `
.hc-render-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  pointer-events: none;
  z-index: 2;
}
.hc-render-overlay-block {
  position: absolute;
  left: 0;
  right: 0;
  background: var(--hc-editor-bg, #fff);
}
.hc-render-overlay-block .hc-render {
  pointer-events: none;
}
.hc-render-overlay-block .hc-render > *:first-child {
  margin-top: 0;
}
.hc-render-overlay-block .hc-render > *:last-child {
  margin-bottom: 0;
}
.hc-line--focused {
  position: relative;
  z-index: 3;
  background: var(--hc-editor-bg, #fff);
}
`

export function ensureRenderOverlayStyles() {
  if (document.getElementById(OVERLAY_STYLE_ID)) return
  const el = document.createElement('style')
  el.id = OVERLAY_STYLE_ID
  el.textContent = OVERLAY_CSS
  document.head.appendChild(el)
}
