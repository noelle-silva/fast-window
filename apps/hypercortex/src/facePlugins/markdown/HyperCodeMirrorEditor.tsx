import React from 'react'
import { ensureHyperCodeMirrorEditorStyles } from '../../editor/styles'
import { formatAssetMarkerInsertion } from '../../assetMarker'
import type { MarkdownRenderEngine } from './render/engine'

// CM6（新一代编辑器核心）
import { basicSetup } from 'codemirror'
import { EditorState, StateField, type Range } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  placeholder as cmPlaceholder,
  type DecorationSet,
} from '@codemirror/view'

import {
  scanLiveBlocks,
  scanAssetPlaceholders,
  selectionIntersects,
  sliceLineEndWithBreak,
  IMAGE_EXTS,
} from './HyperCodeMirrorScanner'
import { HyperBlockWidget, AssetPlaceholderWidget } from './HyperCodeMirrorWidgets'
import { refreshEffect, syntaxHighlightExtension } from './HyperCodeMirrorSyntax'

export interface UnifiedEditorProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  minHeight?: number
  /** 是否处于可见/活跃态：用于 tab 切换后触发一次测量，避免隐藏期间布局漂移。 */
  active?: boolean
  /** 外部触发一次“重建装饰/预览”的信号（例如 noteIndex 更新后要刷新标题渲染）。 */
  refreshToken?: unknown
  /** widget 渲染完成后的后处理钩子（如资源解析）。第二个参数 requestUpdate 用于异步内容就绪后请求重新布局。 */
  onBlockRendered?: (el: HTMLElement, requestUpdate: () => void) => void | (() => void)
  writeClipboardText?: (text: string) => Promise<void>
  showToast?: (message: string) => Promise<void> | void
  onPasteFiles?: (files: File[], insertText: (text: string) => void) => Promise<void> | void
  /** 面渲染引擎（面插件私有）：块级预览与资源占位符由它渲染。 */
  engine: MarkdownRenderEngine
  /** 引用索引：用于引用标题与失效状态渲染。 */
  noteIndexMap?: Record<string, { title: string }>
}

export let globalWriteClipboardText: UnifiedEditorProps['writeClipboardText'] | undefined
export let globalShowToast: UnifiedEditorProps['showToast'] | undefined

function livePreviewExtension(opts: { getOnBlockRendered?: () => UnifiedEditorProps['onBlockRendered']; getEngine: () => MarkdownRenderEngine }) {
  function buildDecos(state: EditorState): DecorationSet {
    const doc = state.doc
    const sel = state.selection.main
    const blocks = scanLiveBlocks(doc)
    const decos: Range<Decoration>[] = []
    for (const b of blocks) {
      if (selectionIntersects({ from: sel.from, to: sel.to, head: sel.head }, b)) continue
      const widget = new HyperBlockWidget(b.kind, b.source, opts.getOnBlockRendered, opts.getEngine())
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

function assetPreviewExtension(opts: { getOnBlockRendered?: () => UnifiedEditorProps['onBlockRendered']; getEngine: () => MarkdownRenderEngine }) {
  function buildDecos(state: EditorState): DecorationSet {
    const doc = state.doc
    const sel = state.selection.main
    const cursorLine = doc.lineAt(sel.head).number
    const assets = scanAssetPlaceholders(doc)
    const decos: Range<Decoration>[] = []

    for (const a of assets) {
      if (a.line === cursorLine) continue
      if (selectionIntersects({ from: sel.from, to: sel.to, head: sel.head }, { from: a.from, focusTo: a.to })) continue

      const forceBlock = IMAGE_EXTS.has(a.ext)
      const widget = new AssetPlaceholderWidget(a.source, opts.getOnBlockRendered, a.inline && !forceBlock, opts.getEngine())

      if (a.inline && !forceBlock) {
        decos.push(Decoration.replace({ widget }).range(a.from, a.to))
        continue
      }

      // 块级：
      // - 独占一行的占位符：替换整行（更稳定）
      // - 行内图片占位符：替换占位符本身，但以 block widget 插入（让图片自然“落到下一行”预览）
      if (!a.inline) {
        const line = doc.line(a.line)
        const from = line.from
        const to = sliceLineEndWithBreak(doc, line)
        decos.push(Decoration.replace({ widget, block: true }).range(from, to))
      } else {
        decos.push(Decoration.replace({ widget, block: true }).range(a.from, a.to))
      }
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

function insertTextAtSelection(view: EditorView, text: string) {
  const insert = String(text || '')
  if (!insert) return
  const selection = view.state.selection.main
  const line = view.state.doc.lineAt(selection.from)
  const before = view.state.doc.sliceString(line.from, selection.from)
  const after = view.state.doc.sliceString(selection.to, line.to)
  const finalText = formatAssetMarkerInsertion(insert, before, after)
  const head = selection.from + finalText.length
  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert: finalText },
    selection: { anchor: head },
    scrollIntoView: true,
  })
  view.focus()
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
  active,
  refreshToken,
  onBlockRendered,
  writeClipboardText,
  showToast,
  onPasteFiles,
  engine,
  noteIndexMap,
}: UnifiedEditorProps) {
  const hostRef = React.useRef<HTMLDivElement | null>(null)
  const viewRef = React.useRef<EditorView | null>(null)
  const isApplyingExternalRef = React.useRef(false)
  const onChangeRef = React.useRef(onChange)
  const onBlockRenderedRef = React.useRef(onBlockRendered)
  const onPasteFilesRef = React.useRef(onPasteFiles)
  const engineRef = React.useRef(engine)
  const noteIndexMapRef = React.useRef(noteIndexMap)

  onChangeRef.current = onChange
  onBlockRenderedRef.current = onBlockRendered
  onPasteFilesRef.current = onPasteFiles
  engineRef.current = engine
  noteIndexMapRef.current = noteIndexMap
  globalWriteClipboardText = writeClipboardText
  globalShowToast = showToast

  const syntaxExt = React.useMemo(() => {
    return syntaxHighlightExtension({ getNoteIndexMap: () => noteIndexMapRef.current ?? null })
  }, [])

  const liveExt = React.useMemo(() => {
    return livePreviewExtension({ getOnBlockRendered: () => onBlockRenderedRef.current, getEngine: () => engineRef.current })
  }, [])

  const assetExt = React.useMemo(() => {
    return assetPreviewExtension({ getOnBlockRendered: () => onBlockRenderedRef.current, getEngine: () => engineRef.current })
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
    const pasteFilesHandler = EditorView.domEventHandlers({
      paste(event, view) {
        const files = Array.from(event.clipboardData?.files || []).filter(file => file.size > 0)
        const handler = onPasteFilesRef.current
        if (!files.length || !handler) return false
        event.preventDefault()
        const insertText = (text: string) => insertTextAtSelection(view, text)
        void Promise.resolve(handler(files, insertText)).catch(err => {
          void globalShowToast?.(String((err as any)?.message || err || '粘贴附件失败'))
        })
        return true
      },
    })

    const state = EditorState.create({
      doc: value ?? '',
      extensions: [
        basicSetup,
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ spellcheck: 'false', 'aria-multiline': 'true' }),
        placeholder ? cmPlaceholder(placeholder) : [],
        updateListener,
        pasteFilesHandler,
        syntaxExt,
        assetExt,
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

  React.useEffect(() => {
    const view = viewRef.current
    if (!view) return
    if (active !== true) return
    try {
      view.requestMeasure({
        read: () => null,
        write: () => {},
      })
    } catch (_) {
      // ignore
    }
  }, [active])

  React.useEffect(() => {
    const view = viewRef.current
    if (!view) return
    try {
      view.dispatch({ effects: refreshEffect.of(Date.now()) })
    } catch (_) {
      // ignore
    }
  }, [refreshToken])

  return (
    <div className="hc-cm6-editor-container" style={{ minHeight }}>
      <div ref={hostRef} />
    </div>
  )
})
