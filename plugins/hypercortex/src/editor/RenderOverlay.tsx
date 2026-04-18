import React from 'react'
import { classifyLines } from './lineClassifier'
import { groupLinesIntoSegments, Segment } from './segmenter'
import { ensureRenderOverlayStyles } from './styles'

export interface RenderOverlayProps {
  editorRef: React.RefObject<HTMLDivElement>
  value: string
  /** 每个 block 渲染完成后的后处理钩子（如资源解析）。第二个参数 requestUpdate 用于异步内容就绪后请求重新布局。 */
  onBlockRendered?: (el: HTMLElement, requestUpdate: () => void) => void
}

export const RenderOverlay = React.memo(function RenderOverlay({
  editorRef,
  value,
  onBlockRendered,
}: RenderOverlayProps) {
  const overlayRef = React.useRef<HTMLDivElement>(null)
  const blockCacheRef = React.useRef<Map<string, HTMLDivElement>>(new Map())
  const focusIndexRef = React.useRef<number | null>(null)
  const segmentsRef = React.useRef<Segment[]>([])
  const rafRef = React.useRef<number>(0)
  const scheduleUpdateRef = React.useRef<() => void>(() => {})

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

  const update = React.useCallback(() => {
    const editor = editorRef.current
    const overlay = overlayRef.current
    if (!editor || !overlay) return

    const segments = getSegments(value)
    segmentsRef.current = segments
    const focusIdx = detectFocusSegment(segments)
    const prevFocusIdx = focusIndexRef.current
    focusIndexRef.current = focusIdx

    const children = editor.children

    // Restore previously focused segment lines (remove focused, add collapsed)
    if (prevFocusIdx !== null && prevFocusIdx !== focusIdx && prevFocusIdx < segments.length) {
      const prevSeg = segments[prevFocusIdx]
      if (prevSeg) {
        for (let i = prevSeg.startLine; i < prevSeg.endLine && i < children.length; i++) {
          const el = children[i] as HTMLElement
          el.classList.remove('hc-line--focused')
        }
      }
    }

    // Build overlay and manage line classes
    const frag = document.createDocumentFragment()

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]

      if (i === focusIdx) {
        // Focused: restore all lines to normal, add focused class
        for (let j = seg.startLine; j < seg.endLine && j < children.length; j++) {
          const el = children[j] as HTMLElement
          el.classList.remove('hc-line--collapsed')
          el.classList.add('hc-line--focused')
          el.style.minHeight = ''
        }
        continue
      }

      // Non-focused: render overlay block
      const isEmpty = seg.markdown.trim() === ''

      // First: render the block to measure its height
      let block: HTMLDivElement | null = null
      let renderHeight = 0

      if (!isEmpty) {
        const cacheKey = seg.markdown
        block = blockCacheRef.current.get(cacheKey) ?? null

        if (!block) {
          block = document.createElement('div')
          block.className = 'hc-render-overlay-block'
          const inner = document.createElement('div')
          inner.className = 'hc-render'
          block.appendChild(inner)

          const engine = (window as any).__hcRenderEngine
          if (engine && typeof engine.renderInto === 'function') {
            engine.renderInto(inner, seg.markdown)
          }

          if (onBlockRendered) onBlockRendered(inner, () => scheduleUpdateRef.current())

          blockCacheRef.current.set(cacheKey, block)
          if (blockCacheRef.current.size > 200) {
            const firstKey = blockCacheRef.current.keys().next().value!
            blockCacheRef.current.delete(firstKey)
          }
        }
      }

      // Collapse all lines in this segment except the first
      // First line gets minHeight = max(renderHeight, 0) to hold space
      for (let j = seg.startLine; j < seg.endLine && j < children.length; j++) {
        const el = children[j] as HTMLElement
        el.classList.remove('hc-line--focused')
        if (j === seg.startLine) {
          el.classList.remove('hc-line--collapsed')
          // Will set minHeight after measuring render block
        } else {
          el.classList.add('hc-line--collapsed')
          el.style.minHeight = ''
        }
      }

      if (block && seg.startLine < children.length) {
        // Temporarily add block to overlay to measure its height
        overlay.appendChild(block)
        const firstEl = children[seg.startLine] as HTMLElement
        block.style.top = firstEl.offsetTop + 'px'
        renderHeight = block.offsetHeight
        block.remove()

        // Set first line's minHeight to render height
        firstEl.style.minHeight = renderHeight > 0 ? renderHeight + 'px' : ''

        // Now position the block using the (possibly updated) first line offset
        block.style.top = firstEl.offsetTop + 'px'
        frag.appendChild(block)
      }
    }

    overlay.replaceChildren(frag)
  }, [editorRef, value, getSegments, detectFocusSegment, measureSegmentRect, onBlockRendered])

  React.useEffect(() => {
    const scheduleUpdate = () => {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(update)
    }
    scheduleUpdateRef.current = scheduleUpdate

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
