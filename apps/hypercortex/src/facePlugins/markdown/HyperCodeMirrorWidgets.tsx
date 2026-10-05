import { EditorView, WidgetType } from '@codemirror/view'
import { katex } from './render/vendor'
import type { MarkdownRenderEngine } from './render/engine'
import type { UnifiedEditorProps } from './HyperCodeMirrorEditor'
import type { LiveBlockKind } from './HyperCodeMirrorScanner'

function requestCmLayout(view: EditorView) {
  try {
    // CM6 的高度映射/行号定位依赖测量周期；当 widget 内容异步变高（Mermaid/图片/资源解析等）
    // 若不触发一次 measure，后续行号与内容可能出现“错位漂移”。
    view.requestMeasure({
      read: () => null,
      write: () => {},
    })
  } catch (_) {
    // ignore
  }
}

export class BulletWidget extends WidgetType {
  constructor(readonly indent: number) { super() }
  eq(other: WidgetType) { return other instanceof BulletWidget && other.indent === this.indent }
  toDOM() {
    const span = document.createElement('span')
    span.className = 'cm-hc-bullet'
    span.textContent = '\u2002'.repeat(this.indent) + '•\u2002'
    return span
  }
}

async function copyTextToClipboard(text: string, writeClipboardText?: (text: string) => Promise<void>) {
  const t = String(text || '')
  if (!t) return false
  try {
    if (typeof writeClipboardText === 'function') { await writeClipboardText(t); return true }
    if (navigator?.clipboard?.writeText) { await navigator.clipboard.writeText(t); return true }
  } catch (_) {}
  try {
    const ta = document.createElement('textarea')
    ta.value = t
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.left = '-9999px'
    ta.style.top = '0'
    document.body.appendChild(ta)
    ta.select()
    ta.setSelectionRange(0, ta.value.length)
    const ok = document.execCommand('copy')
    ta.remove()
    return !!ok
  } catch (_) {}
  return false
}

export class InlineMathWidget extends WidgetType {
  constructor(
    readonly tex: string,
    readonly writeClipboardText: (() => UnifiedEditorProps['writeClipboardText']) | undefined,
    readonly showToast: (() => UnifiedEditorProps['showToast']) | undefined,
  ) { super() }
  eq(other: WidgetType) { return other instanceof InlineMathWidget && other.tex === this.tex }
  toDOM(view: EditorView) {
    const span = document.createElement('span')
    span.className = 'cm-hc-inline-math math-inline fw-math-host'
    span.setAttribute('data-tex', this.tex)

    const inner = document.createElement('span')
    inner.className = 'cm-hc-inline-math-inner'

    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'fw-math-copy'
    btn.setAttribute('aria-label', '复制 LaTeX 公式')
    btn.textContent = '⧉'
    btn.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      copyTextToClipboard(`$${this.tex}$`, this.writeClipboardText?.())
        .then((ok) => { if (ok) { try { void this.showToast?.()?.('已复制公式') } catch (_) {} } })
        .catch(() => {})
    })
    span.appendChild(inner)
    span.appendChild(btn)

    if (katex && typeof katex.render === 'function') {
      try { katex.render(this.tex, inner, { displayMode: false, throwOnError: false }) } catch (_) { inner.textContent = this.tex }
    } else {
      inner.textContent = this.tex
    }
    // 公式字体/布局可能在下一帧才稳定，触发一次测量避免高度映射滞后
    requestAnimationFrame(() => requestCmLayout(view))
    return span
  }
  ignoreEvent(e: Event) {
    const target = e.target instanceof Element ? e.target : null
    if (target?.closest?.('button, a, input, textarea, select')) return true
    return false
  }
}

export class InlineNoteRefWidget extends WidgetType {
  constructor(
    readonly noteId: string,
    readonly label: string,
    readonly broken: boolean,
    readonly remarks: string,
  ) { super() }
  eq(other: WidgetType) {
    return other instanceof InlineNoteRefWidget
      && other.noteId === this.noteId
      && other.label === this.label
      && other.broken === this.broken
      && other.remarks === this.remarks
  }
  toDOM() {
    const el = document.createElement('a')
    el.className = this.broken ? 'hc-note-ref hc-note-ref--broken' : 'hc-note-ref'
    el.setAttribute('data-note-id', this.noteId)
    if (this.remarks) el.setAttribute('data-note-remarks', this.remarks)
    el.textContent = this.broken ? `不存在笔记：${this.label}` : this.label
    return el
  }
  ignoreEvent(e: Event) {
    const target = e.target instanceof Element ? e.target : null
    if (target?.closest?.('button,input,textarea,select')) return true
    // 让点击时能落光标、并触发“进入该行 -> 还原源码”。
    return false
  }
}

export class HyperBlockWidget extends WidgetType {
  private cleanup?: () => void

  constructor(
    readonly kind: LiveBlockKind,
    readonly source: string,
    readonly onBlockRendered: (() => UnifiedEditorProps['onBlockRendered']) | undefined,
    readonly engine: MarkdownRenderEngine,
  ) { super() }

  eq(other: WidgetType) {
    return other instanceof HyperBlockWidget && other.kind === this.kind && other.source === this.source
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement('div')
    wrap.className = 'hc-cm6-preview'
    wrap.setAttribute('data-kind', this.kind)

    const inner = document.createElement('div')
    inner.className = 'hc-render'
    wrap.appendChild(inner)

    const runPostRender = () => {
      this.cleanup?.()
      this.cleanup = undefined
      const hook = this.onBlockRendered?.()
      const cleanup = hook?.(inner, () => requestCmLayout(view))
      if (typeof cleanup === 'function') this.cleanup = cleanup
    }

    this.engine.renderInto(inner, this.source, { onAsyncLayout: () => { requestCmLayout(view); runPostRender() } })

    runPostRender()

    // 初次渲染也触发一次布局测量，避免某些情况下高度没及时“认领”
    requestCmLayout(view)

    return wrap
  }

  ignoreEvent(e: Event) {
    const target = e.target instanceof Element ? e.target : null
    if (target?.closest?.('button, a, input, textarea, select')) return true
    // 让点击预览时，光标能落在替换范围边界，从而“翻回源码”进入编辑态
    return false
  }

  destroy() {
    this.cleanup?.()
    this.cleanup = undefined
  }
}

export class AssetPlaceholderWidget extends WidgetType {
  private cleanup?: () => void

  constructor(
    readonly source: string,
    readonly onBlockRendered: (() => UnifiedEditorProps['onBlockRendered']) | undefined,
    readonly inline: boolean,
    readonly engine: MarkdownRenderEngine,
  ) { super() }

  eq(other: WidgetType) {
    return other instanceof AssetPlaceholderWidget && other.source === this.source && other.inline === this.inline
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement(this.inline ? 'span' : 'div')
    wrap.className = this.inline ? 'hc-cm6-inline-preview' : 'hc-cm6-preview'
    wrap.setAttribute('data-kind', this.inline ? 'asset-inline' : 'asset')

    const inner = document.createElement(this.inline ? 'span' : 'div')
    inner.className = 'hc-render'
    wrap.appendChild(inner)

    const runPostRender = () => {
      this.cleanup?.()
      this.cleanup = undefined
      const hook = this.onBlockRendered?.()
      const cleanup = hook?.(inner, () => requestCmLayout(view))
      if (typeof cleanup === 'function') this.cleanup = cleanup
    }

    this.engine.renderInto(inner, this.source, { onAsyncLayout: () => { requestCmLayout(view); runPostRender() }, assetInline: this.inline })

    runPostRender()

    requestCmLayout(view)

    return wrap
  }

  ignoreEvent(e: Event) {
    const target = e.target instanceof Element ? e.target : null
    if (target?.closest?.('button, a, input, textarea, select, audio, video')) return true
    return false
  }

  destroy() {
    this.cleanup?.()
    this.cleanup = undefined
  }
}
