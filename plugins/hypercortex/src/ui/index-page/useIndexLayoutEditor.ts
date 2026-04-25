import * as React from 'react'
import type { FavoriteItemRef, GridLayout, HyperCortexFavoritesDocV1 } from '../../favorites'
import { INDEX_GRID_COLUMNS, INDEX_GRID_GAP_PX, INDEX_GRID_MAX_H, INDEX_GRID_MIN_H, INDEX_GRID_MIN_W, INDEX_GRID_ROW_PX } from './constants'
import { applyLayoutMapToDoc, buildBaseLayoutMap, buildResolvedLayoutMap } from './layoutState'
import type { DragDraft, ResizeDraft } from './types'

type Options = {
  refs: FavoriteItemRef[]
  doc: HyperCortexFavoritesDocV1
  editMode: boolean
  onDocChange: (doc: HyperCortexFavoritesDocV1) => void
}

type GridMetrics = {
  left: number
  top: number
  colWidth: number
}

function pointerDistance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by)
}

export function useIndexLayoutEditor(opts: Options) {
  const { refs, doc, editMode, onDocChange } = opts
  const gridRef = React.useRef<HTMLDivElement | null>(null)
  const [dragDraft, setDragDraft] = React.useState<DragDraft | null>(null)
  const [resizeDraft, setResizeDraft] = React.useState<ResizeDraft | null>(null)
  const [layoutPreview, setLayoutPreview] = React.useState<Map<string, GridLayout>>(new Map())
  const cleanupRef = React.useRef<null | (() => void)>(null)

  React.useEffect(() => {
    setLayoutPreview(buildBaseLayoutMap(refs))
  }, [refs])

  React.useEffect(() => {
    return () => {
      try {
        cleanupRef.current?.()
      } catch {
      }
    }
  }, [])

  const readGridMetrics = React.useCallback((): GridMetrics | null => {
    const el = gridRef.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    const totalGap = INDEX_GRID_GAP_PX * (INDEX_GRID_COLUMNS - 1)
    const colWidth = (rect.width - totalGap) / INDEX_GRID_COLUMNS
    if (!Number.isFinite(colWidth) || colWidth <= 0) return null
    return { left: rect.left, top: rect.top, colWidth }
  }, [])

  const commitPreview = React.useCallback(
    (preview: Map<string, GridLayout>) => {
      const nextDoc = applyLayoutMapToDoc(doc, refs, preview)
      if (nextDoc !== doc) onDocChange(nextDoc)
    },
    [doc, refs, onDocChange],
  )

  const beginDrag = React.useCallback(
    (ref: FavoriteItemRef, e: React.PointerEvent) => {
      if (!editMode || e.button !== 0) return
      if (!readGridMetrics()) return
      const startX = e.clientX
      const startY = e.clientY
      let started = false
      const pointerId = e.pointerId
      let lastPreview = buildBaseLayoutMap(refs)

      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return
        if (!started) {
          if (pointerDistance(startX, startY, ev.clientX, ev.clientY) < 4) return
          started = true
          document.body.style.userSelect = 'none'
        }
        const metrics = readGridMetrics()
        if (!metrics) return
        const nextX = Math.round((ev.clientX - metrics.left) / (metrics.colWidth + INDEX_GRID_GAP_PX) - ref.layout.w / 2)
        const nextY = Math.round((ev.clientY - metrics.top) / (INDEX_GRID_ROW_PX + INDEX_GRID_GAP_PX) - ref.layout.h / 2)
        lastPreview = buildResolvedLayoutMap(refs, ref.id, { x: nextX, y: nextY })
        setDragDraft({ refId: ref.id, x: nextX, y: nextY })
        setLayoutPreview(lastPreview)
      }

      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return
        cleanupRef.current?.()
        cleanupRef.current = null
        document.body.style.userSelect = ''
        setDragDraft(null)
        if (!started) return
        commitPreview(lastPreview)
      }

      cleanupRef.current = () => {
        window.removeEventListener('pointermove', onMove, true)
        window.removeEventListener('pointerup', onUp, true)
        window.removeEventListener('pointercancel', onUp, true)
      }

      window.addEventListener('pointermove', onMove, true)
      window.addEventListener('pointerup', onUp, true)
      window.addEventListener('pointercancel', onUp, true)
    },
    [commitPreview, editMode, readGridMetrics, refs],
  )

  const beginResize = React.useCallback(
    (ref: FavoriteItemRef, e: React.PointerEvent) => {
      if (!editMode || e.button !== 0) return
      e.stopPropagation()
      if (!readGridMetrics()) return
      const startX = e.clientX
      const startY = e.clientY
      let started = false
      const pointerId = e.pointerId
      let lastPreview = buildBaseLayoutMap(refs)

      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return
        if (!started) {
          if (pointerDistance(startX, startY, ev.clientX, ev.clientY) < 3) return
          started = true
          document.body.style.userSelect = 'none'
        }
        const metrics = readGridMetrics()
        if (!metrics) return
        const deltaCols = Math.round((ev.clientX - startX) / (metrics.colWidth + INDEX_GRID_GAP_PX))
        const deltaRows = Math.round((ev.clientY - startY) / (INDEX_GRID_ROW_PX + INDEX_GRID_GAP_PX))
        const nextW = Math.max(INDEX_GRID_MIN_W, ref.layout.w + deltaCols)
        const nextH = Math.min(INDEX_GRID_MAX_H, Math.max(INDEX_GRID_MIN_H, ref.layout.h + deltaRows))
        lastPreview = buildResolvedLayoutMap(refs, ref.id, { w: nextW, h: nextH })
        setResizeDraft({ refId: ref.id, w: nextW, h: nextH })
        setLayoutPreview(lastPreview)
      }

      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return
        cleanupRef.current?.()
        cleanupRef.current = null
        document.body.style.userSelect = ''
        setResizeDraft(null)
        if (!started) return
        commitPreview(lastPreview)
      }

      cleanupRef.current = () => {
        window.removeEventListener('pointermove', onMove, true)
        window.removeEventListener('pointerup', onUp, true)
        window.removeEventListener('pointercancel', onUp, true)
      }

      window.addEventListener('pointermove', onMove, true)
      window.addEventListener('pointerup', onUp, true)
      window.addEventListener('pointercancel', onUp, true)
    },
    [commitPreview, editMode, readGridMetrics, refs],
  )

  const getPreviewLayout = React.useCallback(
    (ref: FavoriteItemRef): GridLayout => {
      const preview = layoutPreview.get(ref.id)
      return preview || ref.layout
    },
    [layoutPreview],
  )

  const isDraggingRef = React.useCallback((refId: string) => dragDraft?.refId === refId, [dragDraft])
  const isResizingRef = React.useCallback((refId: string) => resizeDraft?.refId === refId, [resizeDraft])

  return {
    gridRef,
    getPreviewLayout,
    beginDrag,
    beginResize,
    isDraggingRef,
    isResizingRef,
  }
}
