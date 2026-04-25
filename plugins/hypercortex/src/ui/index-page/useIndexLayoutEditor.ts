import * as React from 'react'
import { reorderRefsInFolder, type FavoriteItemRef, type GridLayout, type HyperCortexFavoritesDocV1 } from '../../favorites'
import { INDEX_GRID_COLUMNS, INDEX_GRID_GAP_PX, INDEX_GRID_MAX_H, INDEX_GRID_MIN_H, INDEX_GRID_MIN_W, INDEX_GRID_ROW_PX } from './constants'
import { applyLayoutMapToDoc, buildBaseLayoutMap, buildResolvedLayoutMap, buildSortedLayoutMap } from './layoutState'
import type { ResizeDraft } from './types'

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

export function useIndexLayoutEditor(opts: Options) {
  const { refs, doc, currentFolderId, editMode, onDocChange } = opts
  const gridRef = React.useRef<HTMLDivElement | null>(null)
  const [draggingRefId, setDraggingRefId] = React.useState<string | null>(null)
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

  const commitPreview = React.useCallback(
    (preview: Map<string, GridLayout>) => {
      const nextDoc = applyLayoutMapToDoc(doc, refs, preview)
      if (nextDoc !== doc) onDocChange(nextDoc)
    },
    [doc, refs, onDocChange],
  )

  const beginResize = React.useCallback(
    (ref: FavoriteItemRef, e: React.PointerEvent) => {
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
    [commitPreview, editMode, refs],
  )

  const handleSortMove = React.useCallback(
    (activeId: string, overId: string) => {
      if (!editMode) return
      const nextPreview = buildSortedLayoutMap(refs, activeId, overId)
      setLayoutPreview(nextPreview)
      const nextOrder = refs
        .slice()
        .sort((a, b) => {
          const aa = nextPreview.get(a.id)
          const bb = nextPreview.get(b.id)
          if (!aa || !bb) return 0
          return aa.y - bb.y || aa.x - bb.x
        })
        .map(ref => ref.id)
      const nextDoc = reorderRefsInFolder(applyLayoutMapToDoc(doc, refs, nextPreview), currentFolderId, nextOrder)
      if (nextDoc !== doc) onDocChange(nextDoc)
    },
    [currentFolderId, doc, editMode, onDocChange, refs],
  )

  const handleSortPreview = React.useCallback(
    (activeId: string, overId: string | null) => {
      if (!editMode) return
      if (!activeId || !overId || activeId === overId) {
        setLayoutPreview(buildBaseLayoutMap(refs))
        return
      }
      setLayoutPreview(buildSortedLayoutMap(refs, activeId, overId))
    },
    [editMode, refs],
  )

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

  const sortableIds = React.useMemo(() => refs.map(ref => ref.id), [refs])
  const isResizingRef = React.useCallback((refId: string) => resizeDraft?.refId === refId, [resizeDraft])

  return {
    gridRef,
    sortableIds,
    draggingRefId,
    getPreviewLayout,
    beginResize,
    handleSortMove,
    handleSortPreview,
    handleDragStateChange,
    isResizingRef,
  }
}
