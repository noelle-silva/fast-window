import * as React from 'react'
import { useDroppable } from '@dnd-kit/core'
import {
  SortableContext,
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

// 拖拽侧启用开关：非活动侧（指针不在、且非拖拽来源）的条目走静态渲染，
// 不订阅拖拽上下文，从而不随拖拽刷新，也不参与测量与碰撞。
const SortableSideEnabledContext = React.createContext(true)

export function SortableSideScope(props: { enabled: boolean; children: React.ReactNode }) {
  return <SortableSideEnabledContext.Provider value={props.enabled}>{props.children}</SortableSideEnabledContext.Provider>
}

const STATIC_ITEM_ARGS: SortableItemRenderArgs = {
  setNodeRef: () => {},
  setHandleRef: () => {},
  handleProps: {},
  isDragging: false,
  style: {},
}

const STATIC_SLOT_ARGS: SortableDropSlotRenderArgs = { setNodeRef: () => {}, isOver: false }

export function resolveSortMovePosition(items: string[], activeId: string, overId: string): SortMovePosition | null {
  const fromIndex = items.indexOf(activeId)
  const toIndex = items.indexOf(overId)
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return null
  return fromIndex < toIndex ? 'after' : 'before'
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
  const sideEnabled = React.useContext(SortableSideEnabledContext)
  if (disabled || !sideEnabled) return <>{children(STATIC_ITEM_ARGS)}</>
  return (
    <ActiveSortableItem id={id} disableTransform={disableTransform}>
      {children}
    </ActiveSortableItem>
  )
}

function ActiveSortableItem(props: {
  id: string
  disableTransform: boolean
  children: (args: SortableItemRenderArgs) => React.ReactNode
}) {
  const { id, disableTransform, children } = props
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id })

  const style = React.useMemo<React.CSSProperties>(
    () => ({
      transform: disableTransform ? undefined : CSS.Transform.toString(transform),
      transition: disableTransform ? undefined : transition,
      zIndex: isDragging ? 2 : undefined,
    }),
    [disableTransform, isDragging, transform, transition],
  )

  return <>{children({ setNodeRef, setHandleRef: setActivatorNodeRef, handleProps: { ...attributes, ...listeners }, isDragging, style })}</>
}

export function SortableDropSlot(props: SortableDropSlotProps) {
  const { id, disabled = false, children } = props
  const sideEnabled = React.useContext(SortableSideEnabledContext)
  if (disabled || !sideEnabled) return <>{children(STATIC_SLOT_ARGS)}</>
  return <ActiveDropSlot id={id}>{children}</ActiveDropSlot>
}

function ActiveDropSlot(props: { id: string; children: (args: SortableDropSlotRenderArgs) => React.ReactNode }) {
  const { id, children } = props
  const { isOver, setNodeRef } = useDroppable({ id })
  return <>{children({ setNodeRef, isOver })}</>
}

export { verticalListSortingStrategy }
