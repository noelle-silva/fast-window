import * as React from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  pointerWithin,
  rectIntersection,
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
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  type SortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

export type SortMovePosition = 'before' | 'after'
export type SortableDragMode = 'sort' | 'drop'

type SortableDragState = {
  activeId: string
  overId: string
  mode: SortableDragMode
  startedFromHandle: boolean
}

export type SortableDropConfig = {
  canDrop: (activeId: string, targetId: string) => boolean
  onDrop: (activeId: string, targetId: string) => void
}

type SortableRootContextValue = {
  dragState: SortableDragState | null
  drop: SortableDropConfig | null
  shouldSuppressClick: (id: string) => boolean
}

export type SortableItemRenderArgs = {
  setNodeRef: (node: HTMLElement | null) => void
  setHandleRef: (node: HTMLElement | null) => void
  handleProps: Record<string, any>
  dropActivatorProps: Record<string, any>
  dragMode: SortableDragMode | null
  activeId: string
  overId: string
  isDragging: boolean
  isDropCandidate: boolean
  isDropTarget: boolean
  shouldSuppressClick: () => boolean
  style: React.CSSProperties
}

export type SortableDropTargetRenderArgs = {
  setNodeRef: (node: HTMLElement | null) => void
  dragMode: SortableDragMode | null
  activeId: string
  overId: string
  isDropCandidate: boolean
  isDropTarget: boolean
  shouldSuppressClick: () => boolean
}

export type SortableDragStatusRenderArgs = {
  dragMode: SortableDragMode | null
  activeId: string
  overId: string
  isDragging: boolean
  isDropMode: boolean
}

type SortableRootProps = {
  children: React.ReactNode
  onMove: (activeId: string, overId: string) => void
  drop?: SortableDropConfig
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

type SortableDropTargetProps = {
  id: string
  targetId?: string
  disabled?: boolean
  children: (args: SortableDropTargetRenderArgs) => React.ReactNode
}

type SortableDragStatusProps = {
  children: (args: SortableDragStatusRenderArgs) => React.ReactNode
}

const SortableRootContext = React.createContext<SortableRootContextValue>({
  dragState: null,
  drop: null,
  shouldSuppressClick: () => false,
})

const sortableDragHandleAttribute = 'data-sortable-drag-handle'
const sortableDroppableRole = 'sortable-item'
const standaloneDropTargetRole = 'standalone-drop-target'
const postDragClickSuppressionMs = 260

function hasCtrlKey(event: Event | undefined | null): boolean {
  return !!event && 'ctrlKey' in event && Boolean((event as { ctrlKey?: boolean }).ctrlKey)
}

function resolveDragMode(ctrlKey: boolean, startedFromHandle: boolean): SortableDragMode {
  return ctrlKey || !startedFromHandle ? 'drop' : 'sort'
}

function eventTargetIgnoresCardDrag(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest('button, a, input, textarea, select, [data-dnd-ignore="true"]')
}

function eventStartedFromHandle(event: Event | undefined | null): boolean {
  const target = event?.target
  return target instanceof Element && !!target.closest(`[${sortableDragHandleAttribute}="true"]`)
}

function createDropActivatorProps(listeners: Record<string, any> | undefined | null): Record<string, any> {
  const onPointerDown = listeners?.onPointerDown
  if (typeof onPointerDown !== 'function') return {}
  return {
    onPointerDown(event: React.PointerEvent) {
      if (!event.ctrlKey || event.button !== 0 || eventTargetIgnoresCardDrag(event.target)) return
      onPointerDown(event)
    },
  }
}

function droppableTargetId(droppable: { id: unknown; data?: { current?: Record<string, unknown> } } | null | undefined): string {
  const targetId = droppable?.data?.current?.targetId
  return String(targetId || droppable?.id || '').trim()
}

export function resolveSortMovePosition(items: string[], activeId: string, overId: string): SortMovePosition | null {
  const fromIndex = items.indexOf(activeId)
  const toIndex = items.indexOf(overId)
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return null
  return fromIndex < toIndex ? 'after' : 'before'
}

export function SortableRoot(props: SortableRootProps) {
  const { children, onMove, drop = null, collisionDetection = closestCenter } = props
  const [dragState, setDragState] = React.useState<SortableDragState | null>(null)
  const dragStateRef = React.useRef<SortableDragState | null>(null)
  const clickSuppressionRef = React.useRef({ ids: [] as string[], until: 0 })
  const suppressClickTimerRef = React.useRef<number | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const setCurrentDragState = React.useCallback((next: SortableDragState | null) => {
    dragStateRef.current = next
    setDragState(next)
  }, [])

  const updateCurrentDragState = React.useCallback((patch: Partial<SortableDragState>) => {
    const current = dragStateRef.current
    if (!current) return
    const next = { ...current, ...patch }
    if (next.activeId === current.activeId && next.overId === current.overId && next.mode === current.mode) return
    setCurrentDragState(next)
  }, [setCurrentDragState])

  const suppressNextClick = React.useCallback((...ids: string[]) => {
    const nextIds = Array.from(new Set(ids.map(id => String(id || '').trim()).filter(Boolean)))
    if (!nextIds.length) return
    if (suppressClickTimerRef.current !== null) window.clearTimeout(suppressClickTimerRef.current)
    const until = Date.now() + postDragClickSuppressionMs
    clickSuppressionRef.current = { ids: nextIds, until }
    suppressClickTimerRef.current = window.setTimeout(() => {
      if (clickSuppressionRef.current.until === until) {
        clickSuppressionRef.current = { ids: [], until: 0 }
      }
      suppressClickTimerRef.current = null
    }, postDragClickSuppressionMs)
  }, [])

  const shouldSuppressClick = React.useCallback((id: string) => {
    const current = clickSuppressionRef.current
    return !!id && current.ids.includes(id) && Date.now() <= current.until
  }, [])

  React.useEffect(() => {
    return () => {
      if (suppressClickTimerRef.current !== null) window.clearTimeout(suppressClickTimerRef.current)
    }
  }, [])

  React.useEffect(() => {
    if (!dragState) return
    const handleControlKey = (event: KeyboardEvent) => {
      if (event.key !== 'Control') return
      const current = dragStateRef.current
      if (!current) return
      updateCurrentDragState({ mode: resolveDragMode(event.type === 'keydown', current.startedFromHandle) })
    }
    window.addEventListener('keydown', handleControlKey)
    window.addEventListener('keyup', handleControlKey)
    return () => {
      window.removeEventListener('keydown', handleControlKey)
      window.removeEventListener('keyup', handleControlKey)
    }
  }, [dragState, updateCurrentDragState])

  const resolveCollision = React.useCallback<CollisionDetection>((args) => {
    const current = dragStateRef.current
    if (current?.mode !== 'drop' || !drop) {
      const sortableContainers = args.droppableContainers.filter(container => container.data.current?.role !== standaloneDropTargetRole)
      return collisionDetection({ ...args, droppableContainers: sortableContainers })
    }
    const activeId = String(args.active.id || '').trim()
    const droppableContainers = args.droppableContainers.filter(container => {
      const targetId = droppableTargetId(container)
      return !!targetId && drop.canDrop(activeId, targetId)
    })
    if (!droppableContainers.length) return []
    const dropArgs = { ...args, droppableContainers }
    const pointerCollisions = pointerWithin(dropArgs)
    return pointerCollisions.length ? pointerCollisions : rectIntersection(dropArgs)
  }, [drop, collisionDetection])

  const handleDragStart = React.useCallback((event: DragStartEvent) => {
    const activeId = String(event.active.id || '').trim()
    if (!activeId) return
    const startedFromHandle = eventStartedFromHandle(event.activatorEvent)
    setCurrentDragState({
      activeId,
      overId: '',
      mode: resolveDragMode(hasCtrlKey(event.activatorEvent), startedFromHandle),
      startedFromHandle,
    })
  }, [setCurrentDragState])

  const handleDragOver = React.useCallback((event: DragOverEvent) => {
    updateCurrentDragState({ overId: droppableTargetId(event.over) })
  }, [updateCurrentDragState])

  const handleDragEnd = React.useCallback(
    (event: DragEndEvent) => {
      const activeId = String(event.active.id || '').trim()
      const overContainerId = String(event.over?.id || '').trim()
      const overId = droppableTargetId(event.over)
      const mode = dragStateRef.current?.mode || 'sort'
      setCurrentDragState(null)
      suppressNextClick(activeId, overContainerId, overId)
      if (!activeId || !overId || activeId === overId) return
      if (mode === 'drop') {
        if (drop?.canDrop(activeId, overId)) drop.onDrop(activeId, overId)
        return
      }
      onMove(activeId, overId)
    },
    [drop, onMove, setCurrentDragState, suppressNextClick],
  )

  const handleDragCancel = React.useCallback(() => {
    const activeId = dragStateRef.current?.activeId || ''
    setCurrentDragState(null)
    suppressNextClick(activeId)
  }, [setCurrentDragState, suppressNextClick])

  const contextValue = React.useMemo<SortableRootContextValue>(() => ({
    dragState,
    drop,
    shouldSuppressClick,
  }), [drop, dragState, shouldSuppressClick])
  const autoScroll = dragState?.mode !== 'drop'

  return (
    <SortableRootContext.Provider value={contextValue}>
      <DndContext
        autoScroll={autoScroll}
        sensors={sensors}
        collisionDetection={resolveCollision}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        {children}
      </DndContext>
    </SortableRootContext.Provider>
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
  const { dragState, drop, shouldSuppressClick } = React.useContext(SortableRootContext)
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
    data: { role: sortableDroppableRole },
  })
  const dragMode = dragState?.mode || null
  const activeId = dragState?.activeId || ''
  const overId = dragState?.overId || ''
  const isDropMode = dragMode === 'drop'
  const isDropCandidate = !!activeId && isDropMode && !!drop?.canDrop(activeId, id)
  const isDropTarget = isDropCandidate && overId === id

  const style = React.useMemo<React.CSSProperties>(
    () => ({
      transform: isDropMode && !isDragging ? undefined : CSS.Transform.toString(transform),
      transition: isDropMode && !isDragging ? undefined : transition,
      zIndex: isDragging ? 2 : undefined,
    }),
    [isDropMode, isDragging, transform, transition],
  )

  return <>{children({
    setNodeRef,
    setHandleRef: setActivatorNodeRef,
    handleProps: disabled ? {} : { ...attributes, ...listeners, [sortableDragHandleAttribute]: true },
    dropActivatorProps: disabled || !drop ? {} : createDropActivatorProps(listeners),
    dragMode,
    activeId,
    overId,
    isDragging,
    isDropCandidate,
    isDropTarget,
    shouldSuppressClick: () => shouldSuppressClick(id),
    style,
  })}</>
}

export function SortableDropTarget(props: SortableDropTargetProps) {
  const { id, targetId = id, disabled = false, children } = props
  const { dragState, drop, shouldSuppressClick } = React.useContext(SortableRootContext)
  const { setNodeRef } = useDroppable({ id, disabled: disabled || !drop, data: { role: standaloneDropTargetRole, targetId } })
  const dragMode = dragState?.mode || null
  const activeId = dragState?.activeId || ''
  const overId = dragState?.overId || ''
  const isDropMode = dragMode === 'drop'
  const isDropCandidate = !!activeId && isDropMode && !!drop?.canDrop(activeId, targetId)
  const isDropTarget = isDropCandidate && overId === targetId

  return <>{children({
    setNodeRef,
    dragMode,
    activeId,
    overId,
    isDropCandidate,
    isDropTarget,
    shouldSuppressClick: () => shouldSuppressClick(id) || shouldSuppressClick(targetId),
  })}</>
}

export function SortableDragStatus(props: SortableDragStatusProps) {
  const { children } = props
  const { dragState } = React.useContext(SortableRootContext)
  const dragMode = dragState?.mode || null
  const activeId = dragState?.activeId || ''
  const overId = dragState?.overId || ''

  return <>{children({
    dragMode,
    activeId,
    overId,
    isDragging: !!activeId,
    isDropMode: dragMode === 'drop',
  })}</>
}

export { rectSortingStrategy, verticalListSortingStrategy }
