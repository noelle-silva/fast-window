import React from 'react'
import { basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { EditorView, placeholder as cmPlaceholder } from '@codemirror/view'
import { ensureHyperCodeMirrorEditorStyles } from './styles'
import { htmlHighlightExtension } from './htmlHighlight'

export interface CodeMirrorCodeEditorProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  minHeight?: number
  /** 是否处于可见/活跃态：用于 tab 切换后触发一次测量，避免隐藏期间布局漂移。 */
  active?: boolean
  ariaLabel?: string
  lineWrapping?: boolean
  mode?: 'plain' | 'html'
}

export const CodeMirrorCodeEditor = React.memo(function CodeMirrorCodeEditor({
  value,
  onChange,
  placeholder,
  minHeight = 320,
  active,
  ariaLabel,
  lineWrapping = true,
  mode = 'plain',
}: CodeMirrorCodeEditorProps) {
  const hostRef = React.useRef<HTMLDivElement | null>(null)
  const viewRef = React.useRef<EditorView | null>(null)
  const isApplyingExternalRef = React.useRef(false)
  const onChangeRef = React.useRef(onChange)

  onChangeRef.current = onChange

  React.useLayoutEffect(() => {
    ensureHyperCodeMirrorEditorStyles()

    const parent = hostRef.current
    if (!parent) return

    const updateListener = EditorView.updateListener.of((u) => {
      if (!u.docChanged) return
      if (isApplyingExternalRef.current) return
      onChangeRef.current(u.state.doc.toString())
    })

    const state = EditorState.create({
      doc: value ?? '',
      extensions: [
        basicSetup,
        lineWrapping ? EditorView.lineWrapping : [],
        EditorView.contentAttributes.of({
          spellcheck: 'false',
          'aria-multiline': 'true',
          ...(ariaLabel ? { 'aria-label': ariaLabel } : {}),
        }),
        placeholder ? cmPlaceholder(placeholder) : [],
        updateListener,
        mode === 'html' ? htmlHighlightExtension() : [],
      ],
    })

    const view = new EditorView({ state, parent })
    viewRef.current = view

    return () => {
      viewRef.current = null
      view.destroy()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
      requestAnimationFrame(() => { isApplyingExternalRef.current = false })
    }
  }, [value])

  React.useEffect(() => {
    const view = viewRef.current
    if (!view) return
    if (active !== true) return
    try {
      view.requestMeasure({ read: () => null, write: () => {} })
    } catch (_) {
      // ignore
    }
  }, [active])

  return (
    <div className="hc-cm6-editor-container hc-cm6-code" style={{ minHeight }}>
      <div ref={hostRef} />
    </div>
  )
})
