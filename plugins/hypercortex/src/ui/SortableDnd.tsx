import * as React from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  type SortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

export type SortMovePosition = 'before' | 'after'

export type SortableItemRenderArgs = {
  setNodeRef: (node: HTMLElement | null) => void
  setHandleRef: (node: HTMLElement | null) => void
  handleProps: Record<string, any>
  isDragging: boolean
  style: React.CSSProperties
}

export type SortableDropSlotRenderArgs = {
  setNodeRef: (node: HTMLElement | null) => void
  isOver: boolean
}

const SORTABLE_MEASURING = { droppable: { strategy: MeasuringStrategy.Always } }

type SortableRootProps = {
  children: React.ReactNode
  overlay?: React.ReactNode
  onMove: (activeId: string, overId: string, event: DragEndEvent) => void
  onPreviewMove?: (activeId: string, overId: string, event: DragOverEvent) => void
  onDragCancel?: () => void
  onDragStart?: (activeId: string, event: DragStartEvent) => void
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
  disableTransform?: boolean
  children: (args: SortableItemRenderArgs) => React.ReactNode
}

type SortableDropSlotProps = {
  id: string
  disabled?: boolean
  children: (args: SortableDropSlotRenderArgs) => React.ReactNode
}

export function resolveSortMovePosition(items: string[], activeId: string, overId: string): SortMovePosition | null {
  const fromIndex = items.indexOf(activeId)
  const toIndex = items.indexOf(overId)
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return null
  return fromIndex < toIndex ? 'after' : 'before'
}

export function SortableRoot(props: SortableRootProps) {
  const { children, overlay, onMove, onPreviewMove, onDragCancel, onDragStart, collisionDetection = closestCenter } = props
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragStart = React.useCallback(
    (event: DragStartEvent) => {
      const activeId = String(event.active.id || '').trim()
      if (!activeId) return
      onDragStart?.(activeId, event)
    },
    [onDragStart],
  )

  const handleDragOver = React.useCallback(
    (event: DragOverEvent) => {
      const activeId = String(event.active.id || '').trim()
      const overId = String(event.over?.id || '').trim()
      if (!activeId || !overId) return
      onPreviewMove?.(activeId, overId, event)
    },
    [onPreviewMove],
  )

  const handleDragEnd = React.useCallback(
    (event: DragEndEvent) => {
      const activeId = String(event.active.id || '').trim()
      const overId = String(event.over?.id || '').trim()
      if (!activeId || !overId) {
        onDragCancel?.()
        return
      }
      onMove(activeId, overId, event)
    },
    [onDragCancel, onMove],
  )

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      measuring={SORTABLE_MEASURING}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={onDragCancel}
    >
      {children}
      <DragOverlay>{overlay}</DragOverlay>
    </DndContext>
  )
}

export function SortableSection(props: SortableSectionProps) {
  const { items, strategy = verticalListSortingStrategy, children } = props
  return (
    <SortableContext items={items} strategy={strategy}>
      {children}
    </SortableContext>
  )
}

export function SortableItem(props: SortableItemProps) {
  const { id, disabled = false, disableTransform = false, children } = props
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id, disabled })

  const style = React.useMemo<React.CSSProperties>(
    () => ({
      transform: disableTransform ? undefined : CSS.Transform.toString(transform),
      transition: disableTransform ? undefined : transition,
      zIndex: isDragging ? 2 : undefined,
    }),
    [disableTransform, isDragging, transform, transition],
  )

  return <>{children({ setNodeRef, setHandleRef: setActivatorNodeRef, handleProps: disabled ? {} : { ...attributes, ...listeners }, isDragging, style })}</>
}

export function SortableDropSlot(props: SortableDropSlotProps) {
  const { id, disabled = false, children } = props
  const { isOver, setNodeRef } = useDroppable({ id, disabled })
  return <>{children({ setNodeRef, isOver })}</>
}

export { verticalListSortingStrategy }
