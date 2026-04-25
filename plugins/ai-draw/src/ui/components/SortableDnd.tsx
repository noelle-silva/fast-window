import * as React from 'react'
import {
  DndContext,
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

type SortableRootProps = {
  children: React.ReactNode
  onMove: (activeId: string, overId: string) => void
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

export function resolveSortMovePosition(items: string[], activeId: string, overId: string): SortMovePosition | null {
  const fromIndex = items.indexOf(activeId)
  const toIndex = items.indexOf(overId)
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return null
  return fromIndex < toIndex ? 'after' : 'before'
}

export function SortableRoot(props: SortableRootProps) {
  const { children, onMove, collisionDetection = closestCenter } = props
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragEnd = React.useCallback(
    (event: DragEndEvent) => {
      const activeId = String(event.active.id || '').trim()
      const overId = String(event.over?.id || '').trim()
      if (!activeId || !overId || activeId === overId) return
      onMove(activeId, overId)
    },
    [onMove],
  )

  return (
    <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragEnd={handleDragEnd}>
      {children}
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
  const { id, disabled = false, children } = props
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id, disabled })

  const style = React.useMemo<React.CSSProperties>(
    () => ({
      transform: CSS.Transform.toString(transform),
      transition,
      zIndex: isDragging ? 2 : undefined,
    }),
    [isDragging, transform, transition],
  )

  return <>{children({ setNodeRef, setHandleRef: setActivatorNodeRef, handleProps: disabled ? {} : { ...attributes, ...listeners }, isDragging, style })}</>
}

export { rectSortingStrategy, verticalListSortingStrategy }
