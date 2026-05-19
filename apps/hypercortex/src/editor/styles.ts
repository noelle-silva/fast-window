/** 编辑器样式（自注入，不依赖外部 CSS 文件） */

/* ================================================================== */
/*  HyperCodeMirror (CM6) 编辑器样式                                    */
/* ================================================================== */

const CM6_STYLE_ID = 'hc-cm6-editor-css'

const CM6_CSS = `
/* 容器 */
.hc-cm6-editor-container{
  position:relative;
  width:100%;
  --hc-editor-bg:var(--hc-surface);
}
.hc-cm6-editor-container > div{min-height:inherit;}

/* CodeMirror 本体（尽量与正文观感保持一致） */
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
  color:var(--hc-text);
  caret-color:var(--hc-primary);
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
  color:var(--hc-text-subtle);
}
.hc-cm6-editor-container .cm-activeLine,
.hc-cm6-editor-container .cm-activeLineGutter{
  background:var(--hc-surface-soft);
}
.hc-cm6-editor-container .cm-selectionBackground,
.hc-cm6-editor-container .cm-content ::selection{
  background:var(--hc-primary-soft);
}
.hc-cm6-editor-container .cm-cursor{
  border-left:0;
  width:2px;
  background:var(--hc-primary);
}

/* 代码编辑（HTML / 纯源码）：更“像编辑器”一点 */
.hc-cm6-editor-container.hc-cm6-code .cm-scroller{
  font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size:13px;
  line-height:1.6;
  color:var(--hc-text);
}

/* Live Preview 小组件（自然融入正文） */
.hc-cm6-preview{
  position:relative;
  /* 说明：不要用 margin 来制造上下间距（CM6 的高度测量不会把 margin 计入 heightMap）
     否则在折叠/预览块之后，gutter 行号可能开始与内容“错位漂移”。 */
  display:flow-root;
  background:transparent;
  border:none;
  box-shadow:none;
  margin:0;
  padding:4px 0;
}

/* Live Preview 右上角动作按钮（仅用于“弹预览”，避免与点击回源码冲突） */
.hc-cm6-preview-actions{
  position:absolute;
  top:6px;
  right:6px;
  z-index:2;
  display:flex;
  gap:6px;
}
.hc-cm6-preview-action-btn{
  height:22px;
  padding:0 8px;
  border-radius:999px;
  border:0;
  background:var(--hc-surface-soft);
  color:var(--hc-text-muted);
  font-size:12px;
  line-height:1;
  font-weight:700;
  cursor:pointer;
  user-select:none;
  -webkit-user-select:none;
  backdrop-filter:blur(6px);
  -webkit-backdrop-filter:blur(6px);
}
.hc-cm6-preview-action-btn:hover{
  background:var(--hc-surface-muted);
  color:var(--hc-text);
}
.hc-cm6-preview-action-btn:active{
  transform:translateY(1px);
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
  color:var(--hc-text);
}
.cm-hc-h1{
  font-size:1.6em;
  padding-bottom:4px;
}
.cm-hc-h2{font-size:1.4em;}
.cm-hc-h3{font-size:1.2em;}
.cm-hc-h4{font-size:1em;font-weight:600;}
.cm-hc-bold{
  font-weight:bold;
  color:var(--hc-text);
}
.cm-hc-italic{font-style:italic;}
.cm-hc-inline-code{
  font-family:ui-monospace, monospace;
  background:var(--hc-primary-soft);
  color:var(--hc-primary);
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
.cm-hc-link-text{color:var(--hc-primary);text-decoration:underline;text-underline-offset:2px;}
.cm-hc-link-url{color:rgba(0,0,0,0.3);font-size:0.9em;}
.cm-hc-link-url-hide{font-size:0;line-height:0;overflow:hidden;}

/* 图片标记 */
.cm-hc-image-marker{color:rgba(0,0,0,0.3);font-size:0.9em;}

/* 引用块 */
.cm-hc-blockquote{padding-left:12px;background:var(--hc-primary-soft);border-radius:10px;}
.cm-hc-blockquote-marker{color:var(--hc-primary);font-weight:bold;}

/* HTML 高亮（轻量版） */
/* 彩虹调色盘：更“亮”、更有区分度 */
.cm-hc-html-bracket{color:rgba(17,24,39,0.55);}
.cm-hc-html-tag{color:var(--hc-syntax-red);font-weight:800;}        /* red */
.cm-hc-html-attr{color:var(--hc-syntax-amber);font-weight:700;}       /* amber */
.cm-hc-html-operator{color:rgba(17,24,39,0.55);}
.cm-hc-html-value{color:var(--hc-syntax-green);}                      /* green */
.cm-hc-html-string{color:var(--hc-syntax-purple);}                     /* purple */
.cm-hc-html-entity{color:var(--hc-syntax-sky);}                     /* cyan */
.cm-hc-html-doctype{color:var(--hc-syntax-amber);font-weight:800;}    /* yellow */
.cm-hc-html-comment{color:rgba(17,24,39,0.35);font-style:italic;}

/* script/style 内的轻量 JS/CSS 高亮 */
.cm-hc-js-keyword{color:var(--hc-syntax-pink);font-weight:800;}     /* pink */
.cm-hc-js-fn{color:var(--hc-syntax-sky);font-weight:800;}          /* blue */
.cm-hc-js-builtin{color:var(--hc-syntax-teal);font-weight:800;}     /* teal */
.cm-hc-js-number{color:var(--hc-syntax-orange);}                      /* orange */
.cm-hc-js-string{color:var(--hc-syntax-purple);}                      /* purple */
.cm-hc-js-comment{color:rgba(17,24,39,0.35);font-style:italic;}

.cm-hc-css-atrule{color:var(--hc-syntax-purple);font-weight:800;}     /* violet */
.cm-hc-css-prop{color:var(--hc-syntax-sky);font-weight:800;}       /* blue */
.cm-hc-css-value{color:var(--hc-syntax-orange);}                      /* orange */
.cm-hc-css-string{color:var(--hc-syntax-green);}                     /* green */
.cm-hc-css-comment{color:rgba(17,24,39,0.35);font-style:italic;}

/* 列表标记 */
.cm-hc-list-marker{color:var(--hc-primary);font-weight:bold;}
.cm-hc-bullet{color:var(--hc-primary);}

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
  background:var(--hc-surface-muted);
  height:2px;
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
  background:var(--hc-code-bg);
  padding:0 10px;
}
.cm-hc-fence-open{color:var(--hc-code-muted);border-radius:10px 10px 0 0;padding-top:6px;}
.cm-hc-fence-close{color:var(--hc-code-muted);border-radius:0 0 10px 10px;padding-bottom:6px;}
.cm-hc-fence-body{color:var(--hc-code-text);line-height:1.6;}

/* 当光标落在代码块内时，CM6 默认的 activeLine 浅色高亮会“切断”深色代码块，导致形状破碎。
   这里用更高 specificity 覆盖，使代码块在聚焦/非聚焦（预览态）外观保持一致。 */
.hc-cm6-editor-container .cm-activeLine.cm-hc-fence-open,
.hc-cm6-editor-container .cm-activeLine.cm-hc-fence-close,
.hc-cm6-editor-container .cm-activeLine.cm-hc-fence-body{
  background:var(--hc-code-bg);
}

/* 占位符（CM6 placeholder 扩展会用到这个 class） */
.hc-cm6-editor-container .cm-placeholder{
  color:var(--hc-text-subtle);
}
`

export function ensureHyperCodeMirrorEditorStyles() {
  if (document.getElementById(CM6_STYLE_ID)) return
  const el = document.createElement('style')
  el.id = CM6_STYLE_ID
  el.textContent = CM6_CSS
  document.head.appendChild(el)
}
