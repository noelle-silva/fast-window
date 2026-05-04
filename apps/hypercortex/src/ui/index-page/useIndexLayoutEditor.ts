import * as React from 'react'
import { type FavoriteItemRef, type GridLayout, type HyperCortexFavoritesDocV1 } from '../../favorites'
import { INDEX_GRID_COLUMNS, INDEX_GRID_GAP_PX, INDEX_GRID_MAX_H, INDEX_GRID_MIN_H, INDEX_GRID_MIN_W, INDEX_GRID_ROW_PX } from './constants'
import { applyLayoutMapToDoc, buildBaseLayoutMap, buildResolvedLayoutMap } from './layoutState'
import type { ResizeDraft, ResizeHandleDirection } from './types'

type Options = {
  refs: FavoriteItemRef[]
  doc: HyperCortexFavoritesDocV1
  currentFolderId: string
  editMode: boolean
  onDocChange: (doc: HyperCortexFavoritesDocV1) => void
}

function pointerDistance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by)
}

function buildResizePatch(layout: GridLayout, direction: ResizeHandleDirection, deltaCols: number, deltaRows: number): GridLayout {
  const resizingWest = direction.includes('w')
  const resizingNorth = direction.includes('n')
  const resizingHorizontal = direction.includes('w') || direction.includes('e')
  const resizingVertical = direction.includes('n') || direction.includes('s')

  const minWidthDelta = INDEX_GRID_MIN_W - layout.w
  const maxWidthDelta = INDEX_GRID_COLUMNS - (resizingWest ? layout.x : layout.x + layout.w)
  const rawWidthDelta = resizingHorizontal ? (resizingWest ? -deltaCols : deltaCols) : 0
  const widthDelta = Math.max(minWidthDelta, Math.min(maxWidthDelta, rawWidthDelta))

  const minHeightDelta = INDEX_GRID_MIN_H - layout.h
  const maxHeightDelta = INDEX_GRID_MAX_H - layout.h
  const rawHeightDelta = resizingVertical ? (resizingNorth ? -deltaRows : deltaRows) : 0
  const heightDelta = Math.max(minHeightDelta, Math.min(maxHeightDelta, rawHeightDelta))

  return {
    x: resizingWest ? layout.x - widthDelta : layout.x,
    y: resizingNorth ? layout.y - heightDelta : layout.y,
    w: layout.w + widthDelta,
    h: layout.h + heightDelta,
  }
}

export function useIndexLayoutEditor(opts: Options) {
  const { refs, doc, currentFolderId, editMode, onDocChange } = opts
  const gridRef = React.useRef<HTMLDivElement | null>(null)
  const [draggingRefId, setDraggingRefId] = React.useState<string | null>(null)
  const [resizeDraft, setResizeDraft] = React.useState<ResizeDraft | null>(null)
  const [layoutPreview, setLayoutPreview] = React.useState<Map<string, GridLayout>>(new Map())
  const [dropIndicatorLayout, setDropIndicatorLayout] = React.useState<GridLayout | null>(null)
  const cleanupRef = React.useRef<null | (() => void)>(null)
  const dragPreviewRef = React.useRef<Map<string, GridLayout> | null>(null)

  React.useEffect(() => {
    dragPreviewRef.current = null
    setLayoutPreview(buildBaseLayoutMap(refs))
    setDropIndicatorLayout(null)
  }, [refs])

  React.useEffect(() => {
    return () => {
      try {
        cleanupRef.current?.()
      } catch {
      }
    }
  }, [])

  const commitPreview = React.useCallback(
    (preview: Map<string, GridLayout>) => {
      const nextDoc = applyLayoutMapToDoc(doc, refs, preview)
      if (nextDoc !== doc) onDocChange(nextDoc)
    },
    [doc, refs, onDocChange],
  )

  const beginResize = React.useCallback(
    (ref: FavoriteItemRef, direction: ResizeHandleDirection, e: React.PointerEvent) => {
      if (!editMode || e.button !== 0) return
      e.stopPropagation()
      const el = gridRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const totalGap = INDEX_GRID_GAP_PX * (INDEX_GRID_COLUMNS - 1)
      const colWidth = (rect.width - totalGap) / INDEX_GRID_COLUMNS
      if (!Number.isFinite(colWidth) || colWidth <= 0) return
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
        const deltaCols = Math.round((ev.clientX - startX) / (colWidth + INDEX_GRID_GAP_PX))
        const deltaRows = Math.round((ev.clientY - startY) / (INDEX_GRID_ROW_PX + INDEX_GRID_GAP_PX))
        const nextLayout = buildResizePatch(ref.layout, direction, deltaCols, deltaRows)
        lastPreview = buildResolvedLayoutMap(refs, ref.id, nextLayout)
        setResizeDraft({ refId: ref.id, w: nextLayout.w, h: nextLayout.h })
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
    [commitPreview, editMode, refs],
  )

  const previewDragLayout = React.useCallback(
    (refId: string, patch: Partial<GridLayout>) => {
      if (!editMode) return
      const nextPreview = buildResolvedLayoutMap(refs, refId, patch)
      dragPreviewRef.current = nextPreview
      setLayoutPreview(nextPreview)
      setDropIndicatorLayout(nextPreview.get(refId) || null)
    },
    [editMode, refs],
  )

  const commitDragPreview = React.useCallback(() => {
    if (!editMode) return
    const nextPreview = dragPreviewRef.current
    dragPreviewRef.current = null
    setDropIndicatorLayout(null)
    if (!nextPreview) return
    const nextDoc = applyLayoutMapToDoc(doc, refs, nextPreview)
    if (nextDoc !== doc) onDocChange(nextDoc)
  }, [doc, editMode, onDocChange, refs])

  const cancelDragPreview = React.useCallback(() => {
    dragPreviewRef.current = null
    setLayoutPreview(buildBaseLayoutMap(refs))
    setDropIndicatorLayout(null)
  }, [refs])

  const handleDragStateChange = React.useCallback(
    (activeId: string | null) => {
      setDraggingRefId(activeId)
    },
    [],
  )

  const getPreviewLayout = React.useCallback(
    (ref: FavoriteItemRef): GridLayout => {
      const preview = layoutPreview.get(ref.id)
      return preview || ref.layout
    },
    [layoutPreview],
  )

  const isResizingRef = React.useCallback((refId: string) => resizeDraft?.refId === refId, [resizeDraft])

  return {
    gridRef,
    draggingRefId,
    dropIndicatorLayout,
    getPreviewLayout,
    beginResize,
    previewDragLayout,
    commitDragPreview,
    cancelDragPreview,
    handleDragStateChange,
    isResizingRef,
  }
}
