import React from 'react'
import { ensureHyperCodeMirrorEditorStyles } from './styles'

// CM6（新一代编辑器核心）
import { basicSetup } from 'codemirror'
import { EditorState, RangeSetBuilder, type Text } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  placeholder as cmPlaceholder,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'

export interface UnifiedEditorProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  minHeight?: number
  /** widget 渲染完成后的后处理钩子（如资源解析）。第二个参数 requestUpdate 用于异步内容就绪后请求重新布局。 */
  onBlockRendered?: (el: HTMLElement, requestUpdate: () => void) => void
}

type LiveBlockKind = 'latex' | 'mermaid'
type LiveBlock = { from: number; to: number; focusTo: number; kind: LiveBlockKind; source: string }

function requestCmLayout(view: EditorView) {
  const v: any = view as any
  try {
    if (typeof v?.requestMeasure === 'function') v.requestMeasure()
  } catch (_) {
    // ignore
  }
}

function sliceLineEndWithBreak(doc: Text, line: { to: number; number: number }) {
  // Text 以 '\n' 作为换行，line.to 不包含换行符
  return line.number < doc.lines ? line.to + 1 : line.to
}

function scanLiveBlocks(doc: Text): LiveBlock[] {
  const blocks: LiveBlock[] = []
  const isFenceOpen = (t: string) => /^\s*```([A-Za-z0-9_-]+)?\s*$/.exec(t)
  const isFenceClose = (t: string) => /^\s*```\s*$/.test(t)
  const isLatexMarkerLine = (t: string) => String(t || '').trim() === '$$'
  const isSingleLineLatex = (t: string) => /^\s*\$\$[\s\S]*\$\$\s*$/.test(t) && !isLatexMarkerLine(t)

  for (let ln = 1; ln <= doc.lines; ln++) {
    const line = doc.line(ln)
    const text = line.text

    // Mermaid fenced block: ```mermaid ... ```
    const open = isFenceOpen(text)
    if (open) {
      const lang = String(open[1] || '').trim().toLowerCase()
      const isMermaid = lang === 'mermaid'
      if (isMermaid) {
        let endLn = -1
        for (let j = ln + 1; j <= doc.lines; j++) {
          const l2 = doc.line(j)
          if (isFenceClose(l2.text)) { endLn = j; break }
        }
        if (endLn !== -1) {
          const startLine = doc.line(ln)
          const endLine = doc.line(endLn)
          const from = startLine.from
          const to = sliceLineEndWithBreak(doc, endLine)
          blocks.push({ from, to, focusTo: endLine.to, kind: 'mermaid', source: doc.sliceString(from, to) })
          ln = endLn
          continue
        }
      }
    }

    // LaTeX block: $$ ... $$（优先识别“独占一行”的标记）
    if (isLatexMarkerLine(text)) {
      let endLn = -1
      for (let j = ln + 1; j <= doc.lines; j++) {
        const l2 = doc.line(j)
        if (isLatexMarkerLine(l2.text)) { endLn = j; break }
      }
      if (endLn !== -1) {
        const startLine = doc.line(ln)
        const endLine = doc.line(endLn)
        const from = startLine.from
        const to = sliceLineEndWithBreak(doc, endLine)
        blocks.push({ from, to, focusTo: endLine.to, kind: 'latex', source: doc.sliceString(from, to) })
        ln = endLn
        continue
      }
    }

    // 单行 $$...$$（补一个小口子，体验更顺）
    if (isSingleLineLatex(text)) {
      const from = line.from
      const to = sliceLineEndWithBreak(doc, line)
      blocks.push({ from, to, focusTo: line.to, kind: 'latex', source: doc.sliceString(from, to) })
      continue
    }
  }

  return blocks
}

function selectionIntersects(sel: { from: number; to: number; head: number }, block: { from: number; focusTo: number }) {
  // 光标（空选区）：边界也算“进入块内”，这样点击预览会立刻展开源码
  if (sel.from === sel.to) return sel.head >= block.from && sel.head <= block.focusTo
  // 选区：只要有交集就视为“在块内”
  return sel.from <= block.focusTo && sel.to >= block.from
}

const syntaxHighlightPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = this.build(view.state.doc)
    }

    update(update: ViewUpdate) {
      if (update.docChanged) {
        this.decorations = this.build(update.state.doc)
      }
    }

    private build(doc: Text): DecorationSet {
      const builder = new RangeSetBuilder<Decoration>()

      const addMark = (from: number, to: number, className: string) => {
        if (from >= to) return
        builder.add(from, to, Decoration.mark({ class: className }))
      }

      const boldRe = /\*\*(.+?)\*\*/g
      const italicRe = /(^|[^*])\*(?!\*)([^*\n]+?)\*(?!\*)/g
      const inlineCodeRe = /`([^`]*?)`/g

      for (let ln = 1; ln <= doc.lines; ln++) {
        const line = doc.line(ln)
        const t = line.text
        const base = line.from

        // 标题：^(#{1,3}) (.*)$
        const hm = /^(#{1,3}) (.*)$/.exec(t)
        if (hm) {
          const hashes = hm[1]
          const level = hashes.length
          addMark(base, base + level, 'cm-hc-dim')

          const contentFrom = base + level + 1
          const contentTo = base + t.length
          const cls = level === 1 ? 'cm-hc-h1' : level === 2 ? 'cm-hc-h2' : 'cm-hc-h3'
          addMark(contentFrom, contentTo, cls)
        }

        // 加粗：\*\*(.*?)\*\*
        boldRe.lastIndex = 0
        for (let m = boldRe.exec(t); m; m = boldRe.exec(t)) {
          const start = m.index
          const inner = m[1] ?? ''
          const openFrom = base + start
          addMark(openFrom, openFrom + 2, 'cm-hc-dim')
          addMark(openFrom + 2, openFrom + 2 + inner.length, 'cm-hc-bold')
          addMark(openFrom + 2 + inner.length, openFrom + 2 + inner.length + 2, 'cm-hc-dim')
        }

        // 斜体：\*(.*?)\*（不要和加粗冲突）
        italicRe.lastIndex = 0
        for (let m = italicRe.exec(t); m; m = italicRe.exec(t)) {
          const prefix = m[1] ?? ''
          const inner = m[2] ?? ''
          const starFrom = base + m.index + prefix.length
          addMark(starFrom, starFrom + 1, 'cm-hc-dim')
          addMark(starFrom + 1, starFrom + 1 + inner.length, 'cm-hc-italic')
          addMark(starFrom + 1 + inner.length, starFrom + 1 + inner.length + 1, 'cm-hc-dim')
        }

        // 行内代码：`(.*?)`
        inlineCodeRe.lastIndex = 0
        for (let m = inlineCodeRe.exec(t); m; m = inlineCodeRe.exec(t)) {
          const start = m.index
          const inner = m[1] ?? ''
          const openFrom = base + start
          addMark(openFrom, openFrom + 1, 'cm-hc-dim')
          addMark(openFrom + 1, openFrom + 1 + inner.length, 'cm-hc-inline-code')
          addMark(openFrom + 1 + inner.length, openFrom + 1 + inner.length + 1, 'cm-hc-dim')
        }
      }

      return builder.finish()
    }
  },
  { decorations: (v) => v.decorations },
)

class HyperBlockWidget extends WidgetType {
  constructor(
    readonly kind: LiveBlockKind,
    readonly source: string,
    readonly onBlockRendered: (() => UnifiedEditorProps['onBlockRendered']) | undefined,
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

    const engine = (window as any).__hcRenderEngine
    if (engine && typeof engine.renderInto === 'function') {
      engine.renderInto(inner, this.source, { onAsyncLayout: () => requestCmLayout(view) })
    } else {
      inner.textContent = this.source
    }

    const hook = this.onBlockRendered?.()
    if (hook) hook(inner, () => requestCmLayout(view))

    // 初次渲染也触发一次布局测量，避免某些情况下高度没及时“认领”
    requestCmLayout(view)

    return wrap
  }

  ignoreEvent() {
    // 让点击预览时，光标能落在替换范围边界，从而“翻回源码”进入编辑态
    return false
  }
}

function livePreviewExtension(opts: { getOnBlockRendered?: () => UnifiedEditorProps['onBlockRendered'] }) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      private blocks: LiveBlock[]

      constructor(view: EditorView) {
        this.blocks = scanLiveBlocks(view.state.doc)
        this.decorations = this.build(view, this.blocks)
      }

      update(update: ViewUpdate) {
        if (update.docChanged) this.blocks = scanLiveBlocks(update.state.doc)
        if (update.docChanged || update.selectionSet || update.viewportChanged) {
          this.decorations = this.build(update.view, this.blocks)
        }
      }

      private build(view: EditorView, blocks: LiveBlock[]): DecorationSet {
        const sel = view.state.selection.main
        const builder = new RangeSetBuilder<Decoration>()
        for (const b of blocks) {
          if (selectionIntersects({ from: sel.from, to: sel.to, head: sel.head }, b)) continue
          const widget = new HyperBlockWidget(b.kind, b.source, opts.getOnBlockRendered)
          builder.add(b.from, b.to, Decoration.replace({ widget, block: true }))
        }
        return builder.finish()
      }
    },
    { decorations: (v) => v.decorations },
  )
}

/**
 * HyperCodeMirrorEditor（新一代编辑器）
 *
 * - CodeMirror 6 作为文本编辑核心
 * - 扫描 Mermaid / LaTeX 块，光标不在块内时用 widget 做 Live Preview
 * - 光标进入块内时自动露出源码编辑
 * - 对外 props 保持与旧 UnifiedEditor 一致
 */
export const HyperCodeMirrorEditor = React.memo(function HyperCodeMirrorEditor({
  value,
  onChange,
  placeholder,
  minHeight = 200,
  onBlockRendered,
}: UnifiedEditorProps) {
  const hostRef = React.useRef<HTMLDivElement | null>(null)
  const viewRef = React.useRef<EditorView | null>(null)
  const isApplyingExternalRef = React.useRef(false)
  const onChangeRef = React.useRef(onChange)
  const onBlockRenderedRef = React.useRef(onBlockRendered)

  onChangeRef.current = onChange
  onBlockRenderedRef.current = onBlockRendered

  const liveExt = React.useMemo(() => {
    return livePreviewExtension({ getOnBlockRendered: () => onBlockRenderedRef.current })
  }, [])

  React.useLayoutEffect(() => {
    ensureHyperCodeMirrorEditorStyles()

    const parent = hostRef.current
    if (!parent) return

    const updateListener = EditorView.updateListener.of((u) => {
      if (!u.docChanged) return
      if (isApplyingExternalRef.current) return
      const next = u.state.doc.toString()
      onChangeRef.current(next)
    })

    const state = EditorState.create({
      doc: value ?? '',
      extensions: [
        basicSetup,
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ spellcheck: 'false', 'aria-multiline': 'true' }),
        placeholder ? cmPlaceholder(placeholder) : [],
        updateListener,
        syntaxHighlightPlugin,
        liveExt,
      ],
    })

    const view = new EditorView({ state, parent })
    viewRef.current = view

    return () => {
      viewRef.current = null
      view.destroy()
    }
  }, [])

  // 外部 value 同步（加载新笔记 / 切换页面等）
  React.useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const cur = view.state.doc.toString()
    const next = String(value ?? '')
    if (cur === next) return

    isApplyingExternalRef.current = true
    try {
      const head = view.state.selection.main.head
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: next },
        selection: { anchor: Math.min(head, next.length) },
      })
    } finally {
      // 下一帧再放开，避免极端情况下同一轮 updateListener 又触发
      requestAnimationFrame(() => { isApplyingExternalRef.current = false })
    }
  }, [value])

  return (
    <div className="hc-cm6-editor-container" style={{ minHeight }}>
      <div ref={hostRef} />
    </div>
  )
})
