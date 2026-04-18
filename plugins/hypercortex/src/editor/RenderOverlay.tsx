import React from 'react'
import { classifyLines } from './lineClassifier'
import { groupLinesIntoSegments, Segment } from './segmenter'
import { ensureRenderOverlayStyles } from './styles'

export interface RenderOverlayProps {
  editorRef: React.RefObject<HTMLDivElement>
  value: string
}

export const RenderOverlay = React.memo(function RenderOverlay({
  editorRef,
  value,
}: RenderOverlayProps) {
  const overlayRef = React.useRef<HTMLDivElement>(null)
  const blockCacheRef = React.useRef<Map<string, HTMLDivElement>>(new Map())
  const focusIndexRef = React.useRef<number | null>(null)
  const segmentsRef = React.useRef<Segment[]>([])
  const rafRef = React.useRef<number>(0)

  React.useLayoutEffect(() => {
    ensureRenderOverlayStyles()
  }, [])

  const getSegments = React.useCallback((text: string): Segment[] => {
    const lines = text.split('\n')
    const types = classifyLines(lines)
    return groupLinesIntoSegments(lines, types)
  }, [])

  const detectFocusSegment = React.useCallback((segments: Segment[]): number | null => {
    const editor = editorRef.current
    if (!editor) return null
    const sel = window.getSelection()
    if (!sel || !sel.focusNode || !editor.contains(sel.focusNode)) return null

    let node: Node | null = sel.focusNode
    while (node && node.parentNode !== editor) node = node.parentNode
    if (!node) return null

    const lineIndex = Array.from(editor.children).indexOf(node as Element)
    if (lineIndex === -1) return null

    for (let i = 0; i < segments.length; i++) {
      if (lineIndex >= segments[i].startLine && lineIndex < segments[i].endLine) return i
    }
    return null
  }, [editorRef])

  const measureSegmentRect = React.useCallback((
    segment: Segment,
    editor: HTMLDivElement,
  ): { top: number; height: number } | null => {
    const children = editor.children
    if (segment.startLine >= children.length) return null

    const firstEl = children[segment.startLine] as HTMLElement
    const lastEl = children[Math.min(segment.endLine - 1, children.length - 1)] as HTMLElement

    const top = firstEl.offsetTop
    const height = (lastEl.offsetTop + lastEl.offsetHeight) - top
    return { top, height }
  }, [])

  const renderSegmentBlock = React.useCallback((
    segment: Segment,
    rect: { top: number; height: number },
  ): HTMLDivElement => {
    const cacheKey = segment.markdown
    let block = blockCacheRef.current.get(cacheKey)

    if (!block) {
      block = document.createElement('div')
      block.className = 'hc-render-overlay-block'
      const inner = document.createElement('div')
      inner.className = 'hc-render'
      block.appendChild(inner)

      const engine = (window as any).__hcRenderEngine
      if (engine && typeof engine.renderInto === 'function') {
        engine.renderInto(inner, segment.markdown)
      }

      blockCacheRef.current.set(cacheKey, block)
      if (blockCacheRef.current.size > 200) {
        const firstKey = blockCacheRef.current.keys().next().value!
        blockCacheRef.current.delete(firstKey)
      }
    }

    block.style.top = rect.top + 'px'
    block.style.height = rect.height + 'px'
    return block
  }, [])

  const update = React.useCallback(() => {
    const editor = editorRef.current
    const overlay = overlayRef.current
    if (!editor || !overlay) return

    const segments = getSegments(value)
    segmentsRef.current = segments
    const focusIdx = detectFocusSegment(segments)
    focusIndexRef.current = focusIdx

    // Mark focused segment lines with z-index class, clear others
    const children = editor.children
    for (let i = 0; i < children.length; i++) {
      (children[i] as HTMLElement).classList.remove('hc-line--focused')
    }
    if (focusIdx !== null) {
      const seg = segments[focusIdx]
      for (let i = seg.startLine; i < seg.endLine && i < children.length; i++) {
        (children[i] as HTMLElement).classList.add('hc-line--focused')
      }
    }

    const frag = document.createDocumentFragment()

    for (let i = 0; i < segments.length; i++) {
      if (i === focusIdx) continue
      const seg = segments[i]
      if (seg.markdown.trim() === '') continue

      const rect = measureSegmentRect(seg, editor)
      if (!rect || rect.height === 0) continue

      const block = renderSegmentBlock(seg, rect)
      frag.appendChild(block)
    }

    overlay.replaceChildren(frag)
  }, [editorRef, value, getSegments, detectFocusSegment, measureSegmentRect, renderSegmentBlock])

  React.useEffect(() => {
    const scheduleUpdate = () => {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(update)
    }

    scheduleUpdate()

    document.addEventListener('selectionchange', scheduleUpdate)
    return () => {
      document.removeEventListener('selectionchange', scheduleUpdate)
      cancelAnimationFrame(rafRef.current)
    }
  }, [update])

  return (
    <div ref={overlayRef} className="hc-render-overlay" />
  )
})
