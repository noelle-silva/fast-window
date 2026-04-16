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
