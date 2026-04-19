import React from 'react'
import { ensureHyperCodeMirrorEditorStyles } from './styles'

// CM6（新一代编辑器核心）
import { basicSetup } from 'codemirror'
import { EditorState, StateField, type Range, type Text } from '@codemirror/state'
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

type LiveBlockKind = 'latex' | 'mermaid' | 'code' | 'table'
type LiveBlock = { from: number; to: number; focusTo: number; kind: LiveBlockKind; source: string }

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
        blocks.push({
          from,
          to,
          focusTo: endLine.to,
          kind: isMermaid ? 'mermaid' : 'code',
          source: doc.sliceString(from, to),
        })
        ln = endLn
        continue
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

    // 表格：第一行必须 | 开头，后续行 | 开头或纯分隔线 |---|
    if (/^\s*\|/.test(text)) {
      let endLn = ln
      for (let j = ln + 1; j <= doc.lines; j++) {
        const jt = doc.line(j).text
        if (/^\s*\|/.test(jt) || /^[\s|:-]+$/.test(jt) && jt.includes('|')) endLn = j
        else break
      }
      if (endLn > ln) {
        const startLine = doc.line(ln)
        const endLine = doc.line(endLn)
        const from = startLine.from
        const to = sliceLineEndWithBreak(doc, endLine)
        blocks.push({ from, to, focusTo: endLine.to, kind: 'table', source: doc.sliceString(from, to).trim() })
        ln = endLn
        continue
      }
    }
  }

  return blocks
}

function selectionIntersects(sel: { from: number; to: number; head: number }, block: { from: number; focusTo: number }) {
  // 光标（空选区）：边界也算”进入块内”，这样点击预览会立刻展开源码
  if (sel.from === sel.to) return sel.head >= block.from && sel.head <= block.focusTo
  // 选区：只要有交集就视为”在块内”
  return sel.from <= block.focusTo && sel.to >= block.from
}

class BulletWidget extends WidgetType {
  constructor(readonly indent: number) { super() }
  eq(other: WidgetType) { return other instanceof BulletWidget && other.indent === this.indent }
  toDOM() {
    const span = document.createElement('span')
    span.className = 'cm-hc-bullet'
    span.textContent = '\u2002'.repeat(this.indent) + '•\u2002'
    return span
  }
}

const syntaxHighlightPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = this.build(view)
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet) {
        this.decorations = this.build(update.view)
      }
    }

    private build(view: EditorView): DecorationSet {
      const doc = view.state.doc
      const decos: Range<Decoration>[] = []

      const sel = view.state.selection.main
      const cursorLine = doc.lineAt(sel.head).number

      const mark = (from: number, to: number, cls: string) => {
        if (from < to) decos.push(Decoration.mark({ class: cls }).range(from, to))
      }
      const lineDeco = (pos: number, cls: string) => {
        decos.push(Decoration.line({ class: cls }).range(pos))
      }

      const liveBlocks = scanLiveBlocks(doc)

      const lineInfo = new Map<number, string>()
      for (const b of liveBlocks) {
        const focused = selectionIntersects({ from: sel.from, to: sel.to, head: sel.head }, b)
        const startLn = doc.lineAt(b.from).number
        const endLn = doc.lineAt(b.focusTo).number
        for (let ln = startLn; ln <= endLn; ln++) {
          if (!focused) {
            lineInfo.set(ln, 'skip')
          } else if (b.kind === 'code') {
            if (ln === startLn) lineInfo.set(ln, 'fence-open')
            else if (ln === endLn) lineInfo.set(ln, 'fence-close')
            else lineInfo.set(ln, 'fence-body')
          } else {
            lineInfo.set(ln, 'raw')
          }
        }
      }

      const boldRe = /\*\*(.+?)\*\*/g
      const italicRe = /(^|[^*])\*(?!\*)([^*\n]+?)\*(?!\*)/g
      const inlineCodeRe = /`([^`]*?)`/g
      const strikeRe = /~~(.+?)~~/g
      const imageRe = /!\[([^\]]*)\]\(([^)]*)\)/g
      const linkRe = /\[([^\]]*)\]\(([^)]*)\)/g

      for (let ln = 1; ln <= doc.lines; ln++) {
        const info = lineInfo.get(ln)
        if (info === 'skip' || info === 'raw') continue

        const line = doc.line(ln)
        const base = line.from
        const focused = ln === cursorLine

        if (info === 'fence-open' || info === 'fence-close') {
          lineDeco(base, 'cm-hc-fence-close')
          continue
        }
        if (info === 'fence-body') {
          lineDeco(base, 'cm-hc-fence-body')
          continue
        }

        const t = line.text
        const dimOrHide = focused ? 'cm-hc-dim' : 'cm-hc-hide'

        // 标题：非聚焦行隐藏 # 和空格
        const hm = /^(#{1,6}) (.*)$/.exec(t)
        if (hm) {
          const level = hm[1].length
          mark(base, base + level + 1, dimOrHide)
          const cls = level <= 3
            ? (level === 1 ? 'cm-hc-h1' : level === 2 ? 'cm-hc-h2' : 'cm-hc-h3')
            : 'cm-hc-h4'
          mark(base + level + 1, base + t.length, cls)
        }

        // 水平线
        if (/^([-*_]{3,})\s*$/.test(t)) {
          mark(base, base + t.length, 'cm-hc-hr')
          continue
        }

        // 引用
        const bqm = /^(>\s?)(.*)$/.exec(t)
        if (bqm) {
          mark(base, base + (bqm[1] ?? '').length, 'cm-hc-blockquote-marker')
          mark(base, base + t.length, 'cm-hc-blockquote')
        }

        // 列表标记
        const ulm = /^(\s*)([-*+])(\s)/.exec(t)
        if (ulm) {
          const markerFrom = base
          const markerTo = base + ulm[0].length
          if (focused) {
            mark(markerFrom, markerTo, 'cm-hc-list-marker')
          } else {
            const indent = Math.floor((ulm[1] ?? '').length / 2)
            decos.push(Decoration.replace({ widget: new BulletWidget(indent) }).range(markerFrom, markerTo))
          }
        }
        const olm = /^(\s*\d+\.\s)/.exec(t)
        if (olm) mark(base, base + olm[1].length, 'cm-hc-list-marker')

        // 加粗
        boldRe.lastIndex = 0
        for (let m = boldRe.exec(t); m; m = boldRe.exec(t)) {
          const o = base + m.index
          const inner = m[1] ?? ''
          mark(o, o + 2, dimOrHide)
          mark(o + 2, o + 2 + inner.length, 'cm-hc-bold')
          mark(o + 2 + inner.length, o + 2 + inner.length + 2, dimOrHide)
        }

        // 斜体
        italicRe.lastIndex = 0
        for (let m = italicRe.exec(t); m; m = italicRe.exec(t)) {
          const prefix = m[1] ?? ''
          const inner = m[2] ?? ''
          const s = base + m.index + prefix.length
          mark(s, s + 1, dimOrHide)
          mark(s + 1, s + 1 + inner.length, 'cm-hc-italic')
          mark(s + 1 + inner.length, s + 1 + inner.length + 1, dimOrHide)
        }

        // 行内代码
        inlineCodeRe.lastIndex = 0
        for (let m = inlineCodeRe.exec(t); m; m = inlineCodeRe.exec(t)) {
          const o = base + m.index
          const inner = m[1] ?? ''
          mark(o, o + 1, dimOrHide)
          mark(o + 1, o + 1 + inner.length, 'cm-hc-inline-code')
          mark(o + 1 + inner.length, o + 1 + inner.length + 1, dimOrHide)
        }

        // 删除线
        strikeRe.lastIndex = 0
        for (let m = strikeRe.exec(t); m; m = strikeRe.exec(t)) {
          const o = base + m.index
          const inner = m[1] ?? ''
          mark(o, o + 2, dimOrHide)
          mark(o + 2, o + 2 + inner.length, 'cm-hc-strikethrough')
          mark(o + 2 + inner.length, o + 2 + inner.length + 2, dimOrHide)
        }

        // 图片
        const imgRanges: Array<[number, number]> = []
        imageRe.lastIndex = 0
        for (let m = imageRe.exec(t); m; m = imageRe.exec(t)) {
          const f = base + m.index, tt = f + m[0].length
          imgRanges.push([f, tt])
          mark(f, tt, focused ? 'cm-hc-image-marker' : 'cm-hc-hide')
        }

        // 链接
        linkRe.lastIndex = 0
        for (let m = linkRe.exec(t); m; m = linkRe.exec(t)) {
          const f = base + m.index, tt = f + m[0].length
          if (imgRanges.some(([a, b]) => f < b && tt > a)) continue
          const text = m[1] ?? '', url = m[2] ?? ''
          const ob = f
          mark(ob, ob + 1, dimOrHide)
          mark(ob + 1, ob + 1 + text.length, 'cm-hc-link-text')
          mark(ob + 1 + text.length, ob + 1 + text.length + 1, dimOrHide)
          const op = ob + 1 + text.length + 1
          mark(op, op + 1 + url.length + 1, focused ? 'cm-hc-link-url' : 'cm-hc-link-url-hide')
        }
      }

      return Decoration.set(decos, true)
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
  function buildDecos(state: EditorState): DecorationSet {
    const doc = state.doc
    const sel = state.selection.main
    const blocks = scanLiveBlocks(doc)
    const decos: Range<Decoration>[] = []
    for (const b of blocks) {
      if (selectionIntersects({ from: sel.from, to: sel.to, head: sel.head }, b)) continue
      const widget = new HyperBlockWidget(b.kind, b.source, opts.getOnBlockRendered)
      decos.push(Decoration.replace({ widget, block: true }).range(b.from, b.to))
    }
    return Decoration.set(decos, true)
  }

  return StateField.define<DecorationSet>({
    create(state) {
      return buildDecos(state)
    },
    update(value, tr) {
      if (tr.docChanged || tr.selection) {
        return buildDecos(tr.state)
      }
      return value
    },
    provide: (f) => EditorView.decorations.from(f),
  })
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
