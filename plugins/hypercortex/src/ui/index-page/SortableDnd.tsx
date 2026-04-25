import * as React from 'react'
import {
  DndContext,
  DragOverlay,
  type DragCancelEvent,
  type DragOverEvent,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  type SortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

export type SortableItemRenderArgs = {
  setNodeRef: (node: HTMLElement | null) => void
  setHandleRef: (node: HTMLElement | null) => void
  handleProps: Record<string, any>
  isDragging: boolean
  style: React.CSSProperties
}

type SortableRootProps = {
  children: React.ReactNode
  onMove: (activeId: string, overId: string) => void
  onPreviewMove?: (activeId: string, overId: string | null) => void
  onDragStateChange?: (activeId: string | null) => void
  renderOverlay?: (activeId: string, rect: { width: number; height: number } | null) => React.ReactNode
  collisionDetection?: CollisionDetection
}

type SortableSectionProps = {
  items: string[]
  strategy?: SortingStrategy
  children: React.ReactNode
}

type SortableItemProps = {
  id: string
  disabled?: boolean
  children: (args: SortableItemRenderArgs) => React.ReactNode
}

export function SortableRoot(props: SortableRootProps) {
  const { children, onMove, onPreviewMove, onDragStateChange, renderOverlay, collisionDetection = closestCenter } = props
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const [overlayState, setOverlayState] = React.useState<{ activeId: string; rect: { width: number; height: number } | null } | null>(null)

  const handleDragStart = React.useCallback(
    (event: DragStartEvent) => {
      const activeId = String(event.active.id || '').trim()
      const rect = event.active.rect.current.initial
      setOverlayState(
        activeId
          ? {
              activeId,
              rect: rect ? { width: rect.width, height: rect.height } : null,
            }
          : null,
      )
      onDragStateChange?.(activeId || null)
    },
    [onDragStateChange],
  )

  const handleDragOver = React.useCallback(
    (event: DragOverEvent) => {
      const activeId = String(event.active.id || '').trim()
      const overId = String(event.over?.id || '').trim()
      if (!activeId) return
      onPreviewMove?.(activeId, overId || null)
    },
    [onPreviewMove],
  )

  const handleDragEnd = React.useCallback(
    (event: DragEndEvent) => {
      const activeId = String(event.active.id || '').trim()
      const overId = String(event.over?.id || '').trim()
      if (activeId && overId && activeId !== overId) onMove(activeId, overId)
      setOverlayState(null)
      onDragStateChange?.(null)
    },
    [onDragStateChange, onMove],
  )

  const handleDragCancel = React.useCallback(
    (_event: DragCancelEvent) => {
      setOverlayState(null)
      onDragStateChange?.(null)
      onPreviewMove?.('', null)
    },
    [onDragStateChange, onPreviewMove],
  )

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      {children}
      <DragOverlay>
        {overlayState?.activeId ? renderOverlay?.(overlayState.activeId, overlayState.rect) ?? null : null}
      </DragOverlay>
    </DndContext>
  )
}

export function SortableSection(props: SortableSectionProps) {
  const { items, strategy = rectSortingStrategy, children } = props
  return <SortableContext items={items} strategy={strategy}>{children}</SortableContext>
}

export function SortableItem(props: SortableItemProps) {
  const { id, disabled = false, children } = props
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id, disabled })

  const style = React.useMemo<React.CSSProperties>(
    () => {
      const translateOnly = transform
        ? {
            x: transform.x,
            y: transform.y,
            scaleX: 1,
            scaleY: 1,
          }
        : null
      return {
        transform: CSS.Transform.toString(translateOnly),
        transition,
        zIndex: isDragging ? 3 : undefined,
      }
    },
    [isDragging, transform, transition],
  )

  return <>{children({ setNodeRef, setHandleRef: setActivatorNodeRef, handleProps: disabled ? {} : { ...attributes, ...listeners }, isDragging, style })}</>
}

export { rectSortingStrategy }
