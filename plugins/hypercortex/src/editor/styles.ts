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
.hc-line--collapsed {
  height: 0 !important;
  min-height: 0 !important;
  overflow: hidden;
  padding: 0 !important;
  margin: 0 !important;
  border: none !important;
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

/* ================================================================== */
/*  HyperCodeMirror (CM6) 编辑器样式                                    */
/* ================================================================== */

const CM6_STYLE_ID = 'hc-cm6-editor-css'

const CM6_CSS = `
/* 容器 */
.hc-cm6-editor-container{
  position:relative;
  width:100%;
  --hc-editor-bg:#fff;
}
.hc-cm6-editor-container > div{min-height:inherit;}

/* CodeMirror 本体（尽量继承旧 UnifiedEditor 的观感） */
.hc-cm6-editor-container .cm-editor{
  background:transparent;
  outline:none;
  min-height:inherit;
  border-radius:12px;
}
.hc-cm6-editor-container .cm-scroller{
  font-family:'PingFang SC','Microsoft YaHei',system-ui,sans-serif;
  font-size:16px;
  line-height:1.8;
  color:#222;
  caret-color:#1976d2;
  padding:8px 10px;
}
.hc-cm6-editor-container .cm-content{
  padding:0;
}
.hc-cm6-editor-container .cm-line{
  padding:0;
}
.hc-cm6-editor-container .cm-gutters{
  background:transparent;
  border-right:none;
  color:rgba(0,0,0,.35);
}
.hc-cm6-editor-container .cm-activeLine,
.hc-cm6-editor-container .cm-activeLineGutter{
  background:rgba(25,118,210,.04);
}
.hc-cm6-editor-container .cm-selectionBackground,
.hc-cm6-editor-container .cm-content ::selection{
  background:rgba(25,118,210,.18);
}
.hc-cm6-editor-container .cm-cursor{
  border-left:2px solid #1976d2;
}

/* 代码编辑（HTML / 纯源码）：更“像编辑器”一点 */
.hc-cm6-editor-container.hc-cm6-code .cm-scroller{
  font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size:13px;
  line-height:1.6;
  color:#111827;
}

/* Live Preview 小组件（自然融入正文） */
.hc-cm6-preview{
  /* 说明：不要用 margin 来制造上下间距（CM6 的高度测量不会把 margin 计入 heightMap）
     否则在折叠/预览块之后，gutter 行号可能开始与内容“错位漂移”。 */
  display:flow-root;
  background:transparent;
  border:none;
  box-shadow:none;
  margin:0;
  padding:4px 0;
}
.hc-cm6-preview .hc-render table{display:table;}
.hc-cm6-preview .hc-render > *:first-child{margin-top:0;}
.hc-cm6-preview .hc-render > *:last-child{margin-bottom:0;}

/* 行内附件预览：以“小贴纸”形式嵌入，不撑爆行高 */
.hc-cm6-inline-preview{
  display:inline-flex;
  align-items:center;
  vertical-align:middle;
  padding:0 2px;
}
.hc-cm6-inline-preview .hc-render{
  display:inline-flex;
  align-items:center;
}

/* Mark Decoration：语法装饰（标题、强调、行内代码、变淡标记符） */
.cm-hc-h1, .cm-hc-h2, .cm-hc-h3, .cm-hc-h4{
  font-weight:bold;
  color:var(--text-primary, #000);
}
.cm-hc-h1{
  font-size:1.6em;
  border-bottom:1px solid rgba(0,0,0,0.08);
  padding-bottom:4px;
}
.cm-hc-h2{font-size:1.4em;}
.cm-hc-h3{font-size:1.2em;}
.cm-hc-h4{font-size:1em;font-weight:600;}
.cm-hc-bold{
  font-weight:bold;
  color:#000;
}
.cm-hc-italic{font-style:italic;}
.cm-hc-inline-code{
  font-family:ui-monospace, monospace;
  background:rgba(25,118,210,0.06);
  color:#1976d2;
  padding:1px 4px;
  border-radius:4px;
}
.cm-hc-inline-math{
  display:inline-block;
  vertical-align:baseline;
  white-space:nowrap;
}
.cm-hc-dim{color:rgba(0,0,0,0.3);}
.cm-hc-hide{font-size:0;line-height:0;overflow:hidden;}

/* 删除线 */
.cm-hc-strikethrough{text-decoration:line-through;color:rgba(0,0,0,0.45);}

/* 链接 */
.cm-hc-link-text{color:#1976d2;text-decoration:underline;text-underline-offset:2px;}
.cm-hc-link-url{color:rgba(0,0,0,0.3);font-size:0.9em;}
.cm-hc-link-url-hide{font-size:0;line-height:0;overflow:hidden;}

/* 图片标记 */
.cm-hc-image-marker{color:rgba(0,0,0,0.3);font-size:0.9em;}

/* 引用块 */
.cm-hc-blockquote{padding-left:12px;border-left:4px solid rgba(25,118,210,0.35);background:rgba(25,118,210,0.04);}
.cm-hc-blockquote-marker{color:rgba(25,118,210,0.5);font-weight:bold;}

/* HTML 高亮（轻量版） */
/* 彩虹调色盘：更“亮”、更有区分度 */
.cm-hc-html-bracket{color:rgba(17,24,39,0.55);}
.cm-hc-html-tag{color:#ef4444;font-weight:800;}        /* red */
.cm-hc-html-attr{color:#f59e0b;font-weight:700;}       /* amber */
.cm-hc-html-operator{color:rgba(17,24,39,0.55);}
.cm-hc-html-value{color:#22c55e;}                      /* green */
.cm-hc-html-string{color:#a855f7;}                     /* purple */
.cm-hc-html-entity{color:#06b6d4;}                     /* cyan */
.cm-hc-html-doctype{color:#eab308;font-weight:800;}    /* yellow */
.cm-hc-html-comment{color:rgba(17,24,39,0.35);font-style:italic;}

/* script/style 内的轻量 JS/CSS 高亮 */
.cm-hc-js-keyword{color:#ec4899;font-weight:800;}     /* pink */
.cm-hc-js-fn{color:#3b82f6;font-weight:800;}          /* blue */
.cm-hc-js-builtin{color:#14b8a6;font-weight:800;}     /* teal */
.cm-hc-js-number{color:#f97316;}                      /* orange */
.cm-hc-js-string{color:#a855f7;}                      /* purple */
.cm-hc-js-comment{color:rgba(17,24,39,0.35);font-style:italic;}

.cm-hc-css-atrule{color:#8b5cf6;font-weight:800;}     /* violet */
.cm-hc-css-prop{color:#3b82f6;font-weight:800;}       /* blue */
.cm-hc-css-value{color:#f97316;}                      /* orange */
.cm-hc-css-string{color:#22c55e;}                     /* green */
.cm-hc-css-comment{color:rgba(17,24,39,0.35);font-style:italic;}

/* 列表标记 */
.cm-hc-list-marker{color:rgba(25,118,210,0.6);font-weight:bold;}
.cm-hc-bullet{color:rgba(25,118,210,0.6);}

/* 水平线 */
.cm-hc-hr-line{
  position:relative;
}
.cm-hc-hr-line::after{
  content:'';
  position:absolute;
  left:0;
  right:0;
  top:50%;
  border-top:1px solid rgba(0,0,0,0.12);
  transform:translateY(-50%);
  pointer-events:none;
}
.cm-hc-hr-text-hidden{
  color:transparent;
}

/* 代码块围栏行 */
.cm-hc-fence-open,.cm-hc-fence-close,.cm-hc-fence-body{
  box-sizing:border-box;
  font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;
  font-size:13px;
  background:#0b1220;
  padding:0 10px;
  border-left:1px solid rgba(255,255,255,.06);
  border-right:1px solid rgba(255,255,255,.06);
}
.cm-hc-fence-open{color:rgba(255,255,255,0.5);border-radius:10px 10px 0 0;border-top:1px solid rgba(255,255,255,.06);padding-top:6px;}
.cm-hc-fence-close{color:rgba(255,255,255,0.5);border-radius:0 0 10px 10px;border-bottom:1px solid rgba(255,255,255,.06);padding-bottom:6px;}
.cm-hc-fence-body{color:#e5e7eb;line-height:1.6;}

/* 当光标落在代码块内时，CM6 默认的 activeLine 浅色高亮会“切断”深色代码块，导致形状破碎。
   这里用更高 specificity 覆盖，使代码块在聚焦/非聚焦（预览态）外观保持一致。 */
.hc-cm6-editor-container .cm-activeLine.cm-hc-fence-open,
.hc-cm6-editor-container .cm-activeLine.cm-hc-fence-close,
.hc-cm6-editor-container .cm-activeLine.cm-hc-fence-body{
  background:#0b1220;
}

/* 占位符（CM6 placeholder 扩展会用到这个 class） */
.hc-cm6-editor-container .cm-placeholder{
  color:rgba(0,0,0,.42);
}
`

export function ensureHyperCodeMirrorEditorStyles() {
  if (document.getElementById(CM6_STYLE_ID)) return
  const el = document.createElement('style')
  el.id = CM6_STYLE_ID
  el.textContent = CM6_CSS
  document.head.appendChild(el)
}
