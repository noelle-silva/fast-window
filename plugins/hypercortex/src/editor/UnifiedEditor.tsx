import React from 'react'
import { ensureUnifiedEditorStyles } from './styles'
import {
  extractText,
  rebuildDOM,
  reclassifyLines,
  normalizeEditorDOM,
  domSelectionToTextOffset,
  restoreSelectionFromTextOffset,
} from './domHelpers'

export interface UnifiedEditorProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  minHeight?: number
}

interface HistoryEntry {
  text: string
  selStart: number
  selEnd: number
}

const MAX_HISTORY = 100
const DEBOUNCE_MS = 150

const supportsPTOnly = (() => {
  const d = document.createElement('div')
  d.contentEditable = 'plaintext-only'
  return d.contentEditable === 'plaintext-only'
})()

export const UnifiedEditor = React.memo(function UnifiedEditor({
  value,
  onChange,
  placeholder,
  minHeight = 200,
}: UnifiedEditorProps) {
  const editorRef = React.useRef<HTMLDivElement>(null)
  const internalValueRef = React.useRef(value)
  const externalValueRef = React.useRef(value)
  const onChangeRef = React.useRef(onChange)
  onChangeRef.current = onChange

  const isComposingRef = React.useRef(false)
  const isRestoringRef = React.useRef(false)

  const undoStackRef = React.useRef<HistoryEntry[]>([])
  const redoStackRef = React.useRef<HistoryEntry[]>([])
  const pendingSnapshotRef = React.useRef<HistoryEntry | null>(null)
  const debounceTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const [isEmpty, setIsEmpty] = React.useState(!value)

  // ── helpers ──

  const captureSnapshot = React.useCallback((): HistoryEntry => {
    const root = editorRef.current
    const sel = root ? domSelectionToTextOffset(root) : { start: 0, end: 0 }
    return { text: internalValueRef.current, selStart: sel.start, selEnd: sel.end }
  }, [])

  const pushUndo = React.useCallback((entry: HistoryEntry) => {
    const stack = undoStackRef.current
    stack.push(entry)
    if (stack.length > MAX_HISTORY) stack.shift()
    redoStackRef.current = []
  }, [])

  const flushPending = React.useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
    const snap = pendingSnapshotRef.current
    if (snap) {
      pushUndo(snap)
      pendingSnapshotRef.current = null
    }
  }, [pushUndo])

  const recordBeforeChange = React.useCallback(() => {
    if (isRestoringRef.current) return
    if (!pendingSnapshotRef.current) {
      pendingSnapshotRef.current = captureSnapshot()
    }
  }, [captureSnapshot])

  const commitAfterChange = React.useCallback(() => {
    if (isRestoringRef.current) return
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null
      const snap = pendingSnapshotRef.current
      if (snap) {
        pushUndo(snap)
        pendingSnapshotRef.current = null
      }
    }, DEBOUNCE_MS)
  }, [pushUndo])

  const applySnapshot = React.useCallback((entry: HistoryEntry) => {
    const root = editorRef.current
    if (!root) return
    isRestoringRef.current = true
    internalValueRef.current = entry.text
    externalValueRef.current = entry.text
    rebuildDOM(root, entry.text)
    restoreSelectionFromTextOffset(root, entry.selStart, entry.selEnd)
    setIsEmpty(!entry.text)
    onChangeRef.current(entry.text)
    requestAnimationFrame(() => { isRestoringRef.current = false })
  }, [])

  const undo = React.useCallback(() => {
    flushPending()
    const stack = undoStackRef.current
    if (!stack.length) return
    redoStackRef.current.push(captureSnapshot())
    applySnapshot(stack.pop()!)
  }, [flushPending, captureSnapshot, applySnapshot])

  const redo = React.useCallback(() => {
    const stack = redoStackRef.current
    if (!stack.length) return
    flushPending()
    undoStackRef.current.push(captureSnapshot())
    applySnapshot(stack.pop()!)
  }, [flushPending, captureSnapshot, applySnapshot])

  // ── event handlers ──

  const handleBeforeInput = React.useCallback(() => {
    if (isComposingRef.current) return
    if (pendingSnapshotRef.current && pendingSnapshotRef.current.text !== internalValueRef.current) {
      flushPending()
    }
    recordBeforeChange()
  }, [recordBeforeChange, flushPending])

  const handleInput = React.useCallback(() => {
    if (isComposingRef.current) return
    const root = editorRef.current
    if (!root) return

    normalizeEditorDOM(root)
    const newValue = extractText(root)
    if (newValue === internalValueRef.current) return

    internalValueRef.current = newValue
    reclassifyLines(root)
    setIsEmpty(!newValue)
    commitAfterChange()
    externalValueRef.current = newValue
    onChangeRef.current(newValue)
  }, [commitAfterChange])

  const handleKeyDown = React.useCallback((e: React.KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey
    if (mod && e.key === 'z') {
      e.preventDefault()
      e.shiftKey ? redo() : undo()
      return
    }
    if (mod && e.key === 'y') {
      e.preventDefault()
      redo()
      return
    }
    if (e.key === 'Tab') {
      e.preventDefault()
      document.execCommand('insertText', false, '  ')
    }
  }, [undo, redo])

  const handlePaste = React.useCallback((e: React.ClipboardEvent) => {
    if (supportsPTOnly) return
    e.preventDefault()
    const text = e.clipboardData?.getData('text/plain') ?? ''
    document.execCommand('insertText', false, text)
  }, [])

  const handleCompositionStart = React.useCallback(() => {
    isComposingRef.current = true
    recordBeforeChange()
  }, [recordBeforeChange])

  const handleCompositionEnd = React.useCallback(() => {
    isComposingRef.current = false
    handleInput()
  }, [handleInput])

  // ── init ──

  React.useLayoutEffect(() => {
    ensureUnifiedEditorStyles()
    const root = editorRef.current
    if (root) rebuildDOM(root, value)
  }, [])

  // ── beforeinput (native, not React synthetic) ──

  React.useEffect(() => {
    const root = editorRef.current
    if (!root) return
    const handler = () => handleBeforeInput()
    root.addEventListener('beforeinput', handler)
    return () => root.removeEventListener('beforeinput', handler)
  }, [handleBeforeInput])

  // ── external value sync ──

  React.useEffect(() => {
    if (value === externalValueRef.current) return
    externalValueRef.current = value
    internalValueRef.current = value
    setIsEmpty(!value)
    const root = editorRef.current
    if (root) rebuildDOM(root, value)
    undoStackRef.current = []
    redoStackRef.current = []
    pendingSnapshotRef.current = null
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
  }, [value])

  // ── render ──

  const showPlaceholder = isEmpty && placeholder

  return (
    <div className="hc-unified-editor-container" style={{ minHeight }}>
      <div
        ref={editorRef}
        className="hc-unified-editor"
        contentEditable={supportsPTOnly ? 'plaintext-only' as any : true}
        role="textbox"
        aria-multiline={true}
        spellCheck={false}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
      />
      {showPlaceholder && (
        <div className="hc-unified-placeholder">{placeholder}</div>
      )}
    </div>
  )
})
