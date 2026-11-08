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

/** 拖拽模式：sort 换顺序，drop 放到某个目标。 */
export type SortableDragMode = 'sort' | 'drop'

export type SortableDragState = {
  activeId: string
  /** 当前命中容器的 id：排序用它做插入位置，null 表示没有命中。 */
  overId: string | null
  /** 当前命中容器的业务目标 id：放置用它做落点，空串是合法的「根级」。 */
  overTargetId: string | null
  mode: SortableDragMode
}

export type SortableDropConfig = {
  canDrop: (activeId: string, targetId: string) => boolean
  onDrop: (activeId: string, targetId: string) => void
}

export type SortableItemRenderArgs = {
  setNodeRef: (node: HTMLElement | null) => void
  setHandleRef: (node: HTMLElement | null) => void
  handleProps: Record<string, any>
  isDragging: boolean
  style: React.CSSProperties
  dragMode: SortableDragMode | null
  overId: string | null
  /** 当前处于拖拽中、且这一行可以接收落点。 */
  isDropCandidate: boolean
  /** 当前指针正停在这一行上。 */
  isDropTarget: boolean
  shouldSuppressClick: () => boolean
}

export type SortableDropTargetRenderArgs = {
  setNodeRef: (node: HTMLElement | null) => void
  dragMode: SortableDragMode | null
  overId: string | null
  isDropCandidate: boolean
  isDropTarget: boolean
  shouldSuppressClick: () => boolean
}

export type SortableDragStatusRenderArgs = {
  dragMode: SortableDragMode | null
  activeId: string
  overId: string | null
  overTargetId: string | null
  isDragging: boolean
  isDropMode: boolean
}

type SortableRootProps = {
  children: React.ReactNode
  onMove: (activeId: string, overId: string) => void
  onDragStart?: () => void
  onDragStop?: () => void
  /** 提供放置能力；不传则整个区域只有排序。 */
  drop?: SortableDropConfig | null
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
  /** 这一行作为放置目标时对外暴露的业务 id；默认与自身 id 相同。 */
  dropTargetId?: string
  children: (args: SortableItemRenderArgs) => React.ReactNode
}

type SortableDropTargetProps = {
  id: string
  /** 业务目标 id；空串是合法目标（例如「根级」）。 */
  targetId?: string
  disabled?: boolean
  /**
   * 目标优先级：浮层里的目标压在被它遮住的列表目标之上。
   * 拖拽时先只在最高优先级的目标里找落点，找不到再回落到全部候选。
   */
  dropPriority?: number
  children: (args: SortableDropTargetRenderArgs) => React.ReactNode
}

type SortableDragStatusProps = {
  children: (args: SortableDragStatusRenderArgs) => React.ReactNode
}

type SortableRootContextValue = {
  dragState: SortableDragState | null
  drop: SortableDropConfig | null
  shouldSuppressClick: (id: string) => boolean
}

const sortableItemRole = 'sortable-item'
const dropTargetRole = 'drop-target'
/** 拖拽结束后浏览器仍会补发 click：在这段时间内忽略相关行的点击。 */
const clickSuppressionMs = 260

const SortableRootContext = React.createContext<SortableRootContextValue>({
  dragState: null,
  drop: null,
  shouldSuppressClick: () => false,
})

function hasCtrlKey(event: Event | undefined | null): boolean {
  return !!event && 'ctrlKey' in event && Boolean((event as { ctrlKey?: boolean }).ctrlKey)
}

/** 按下时带 Ctrl 就是放置，否则是排序；拖拽中按 Ctrl 会实时切换。 */
export function resolveSortableDragMode(ctrlKey: boolean): SortableDragMode {
  return ctrlKey ? 'drop' : 'sort'
}

function droppableData(value: unknown): Record<string, unknown> | null {
  const data = (value as { current?: unknown } | null | undefined)?.current
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : null
}

/** 容器上登记的业务目标 id；没有登记时回落到容器自身 id。 */
function containerTargetId(container: { id: unknown; data?: unknown }): string {
  const data = droppableData(container.data)
  const targetId = data?.targetId
  return typeof targetId === 'string' ? targetId : String(container.id ?? '')
}

function containerDropPriority(container: { id: unknown; data?: unknown }): number {
  const value = droppableData(container.data)?.dropPriority
  return typeof value === 'number' ? value : 0
}

function readOverTargetId(over: DragOverEvent['over'] | DragEndEvent['over']): string | null {
  if (!over) return null
  return containerTargetId(over as unknown as { id: unknown; data?: unknown })
}

function readOverContainerId(over: DragOverEvent['over'] | DragEndEvent['over']): string | null {
  if (!over) return null
  return String(over.id ?? '')
}

export function resolveSortMovePosition(items: string[], activeId: string, overId: string): SortMovePosition | null {
  const fromIndex = items.indexOf(activeId)
  const toIndex = items.indexOf(overId)
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return null
  return fromIndex < toIndex ? 'after' : 'before'
}

export function useSortableDragState(): SortableDragState | null {
  return React.useContext(SortableRootContext).dragState
}

export function SortableRoot(props: SortableRootProps) {
  const { children, onMove, onDragStart, onDragStop, drop = null, collisionDetection = closestCenter } = props
  const [dragState, setDragState] = React.useState<SortableDragState | null>(null)
  const dragStateRef = React.useRef<SortableDragState | null>(null)
  const clickSuppressionRef = React.useRef<{ ids: string[]; until: number }>({ ids: [], until: 0 })
  const suppressTimerRef = React.useRef<number | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const setCurrentDragState = React.useCallback((next: SortableDragState | null) => {
    dragStateRef.current = next
    setDragState(next)
  }, [])

  const patchDragState = React.useCallback(
    (patch: Partial<SortableDragState>) => {
      const current = dragStateRef.current
      if (!current) return
      const next = { ...current, ...patch }
      if (
        next.overId === current.overId &&
        next.overTargetId === current.overTargetId &&
        next.mode === current.mode
      ) {
        return
      }
      setCurrentDragState(next)
    },
    [setCurrentDragState],
  )

  const suppressClick = React.useCallback((...ids: string[]) => {
    const nextIds = Array.from(new Set(ids.map((id) => String(id ?? '')).filter(Boolean)))
    if (!nextIds.length) return
    if (suppressTimerRef.current !== null) window.clearTimeout(suppressTimerRef.current)
    const until = Date.now() + clickSuppressionMs
    clickSuppressionRef.current = { ids: nextIds, until }
    suppressTimerRef.current = window.setTimeout(() => {
      if (clickSuppressionRef.current.until === until) clickSuppressionRef.current = { ids: [], until: 0 }
      suppressTimerRef.current = null
    }, clickSuppressionMs)
  }, [])

  const shouldSuppressClick = React.useCallback((id: string) => {
    const current = clickSuppressionRef.current
    return !!id && current.ids.includes(id) && Date.now() <= current.until
  }, [])

  React.useEffect(() => {
    return () => {
      if (suppressTimerRef.current !== null) window.clearTimeout(suppressTimerRef.current)
    }
  }, [])

  // 没有放置能力时不必监听 Control：模式切换没有意义。
  const dropEnabled = Boolean(drop)
  const dragging = Boolean(dragState)
  React.useEffect(() => {
    if (!dragging || !dropEnabled) return
    const handleControlKey = (event: KeyboardEvent) => {
      if (event.key !== 'Control') return
      patchDragState({ mode: resolveSortableDragMode(event.type === 'keydown') })
    }
    window.addEventListener('keydown', handleControlKey)
    window.addEventListener('keyup', handleControlKey)
    return () => {
      window.removeEventListener('keydown', handleControlKey)
      window.removeEventListener('keyup', handleControlKey)
    }
  }, [dragging, dropEnabled, patchDragState])

  const resolveCollision = React.useCallback<CollisionDetection>(
    (args) => {
      const current = dragStateRef.current
      const activeId = String(args.active.id ?? '').trim()
      if (!drop || current?.mode !== 'drop') {
        const sortableContainers = args.droppableContainers.filter(
          (container) => droppableData(container.data)?.role !== dropTargetRole,
        )
        return collisionDetection({ ...args, droppableContainers: sortableContainers })
      }
      const droppableContainers = args.droppableContainers.filter((container) => {
        const targetId = containerTargetId(container)
        return drop.canDrop(activeId, targetId)
      })
      if (!droppableContainers.length) return []
      const topPriority = Math.max(...droppableContainers.map(containerDropPriority))
      const prioritized = droppableContainers.filter((container) => containerDropPriority(container) === topPriority)
      const pointerCollisions = pointerWithin({ ...args, droppableContainers: prioritized })
      if (pointerCollisions.length) return pointerCollisions
      return rectIntersection({ ...args, droppableContainers })
    },
    [collisionDetection, drop],
  )

  const handleDragStart = React.useCallback(
    (event: DragStartEvent) => {
      const activeId = String(event.active.id ?? '').trim()
      if (!activeId) return
      setCurrentDragState({
        activeId,
        overId: null,
        overTargetId: null,
        mode: resolveSortableDragMode(dropEnabled && hasCtrlKey(event.activatorEvent)),
      })
      onDragStart?.()
    },
    [dropEnabled, onDragStart, setCurrentDragState],
  )

  const handleDragOver = React.useCallback(
    (event: DragOverEvent) => {
      patchDragState({
        overId: readOverContainerId(event.over),
        overTargetId: readOverTargetId(event.over),
      })
    },
    [patchDragState],
  )

  const handleDragEnd = React.useCallback(
    (event: DragEndEvent) => {
      const activeId = String(event.active.id ?? '').trim()
      const overId = readOverContainerId(event.over)
      const targetId = readOverTargetId(event.over)
      const mode = dragStateRef.current?.mode ?? 'sort'
      setCurrentDragState(null)
      if (activeId) suppressClick(activeId, targetId ?? '')
      onDragStop?.()
      if (!activeId || overId === null) return
      if (mode === 'drop') {
        if (targetId !== null && drop?.canDrop(activeId, targetId)) drop.onDrop(activeId, targetId)
        return
      }
      if (!overId || activeId === overId) return
      onMove(activeId, overId)
    },
    [drop, onDragStop, onMove, setCurrentDragState, suppressClick],
  )

  const handleDragCancel = React.useCallback(() => {
    const activeId = dragStateRef.current?.activeId ?? ''
    setCurrentDragState(null)
    if (activeId) suppressClick(activeId)
    onDragStop?.()
  }, [onDragStop, setCurrentDragState, suppressClick])

  const contextValue = React.useMemo<SortableRootContextValue>(
    () => ({ dragState, drop, shouldSuppressClick }),
    [dragState, drop, shouldSuppressClick],
  )
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
  const { id, disabled = false, dropTargetId, children } = props
  const { dragState, drop, shouldSuppressClick } = React.useContext(SortableRootContext)
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
    data: { role: sortableItemRole, targetId: dropTargetId ?? id },
  })
  const dragMode = dragState?.mode ?? null
  const overId = dragState?.overId ?? null
  const overTargetId = dragState?.overTargetId ?? null
  const activeId = dragState?.activeId ?? ''
  const targetId = dropTargetId ?? id
  const isDropMode = dragMode === 'drop'
  const isDropCandidate = !!activeId && isDropMode && !!drop?.canDrop(activeId, targetId)
  const isDropTarget = isDropCandidate && overTargetId === targetId

  // 放置模式下这一行不参与让位：列表保持原位，只有目标行高亮。
  const style = React.useMemo<React.CSSProperties>(
    () => ({
      transform: isDropMode && !isDragging ? undefined : CSS.Transform.toString(transform),
      transition: isDropMode && !isDragging ? undefined : transition,
      zIndex: isDragging ? 2 : undefined,
    }),
    [isDropMode, isDragging, transform, transition],
  )

  return (
    <>
      {children({
        setNodeRef,
        setHandleRef: setActivatorNodeRef,
        handleProps: disabled ? {} : { ...attributes, ...listeners },
        isDragging,
        style,
        dragMode,
        overId,
        isDropCandidate,
        isDropTarget,
        shouldSuppressClick: () => shouldSuppressClick(id),
      })}
    </>
  )
}

export function SortableDropTarget(props: SortableDropTargetProps) {
  const { id, targetId = id, disabled = false, dropPriority = 0, children } = props
  const { dragState, drop, shouldSuppressClick } = React.useContext(SortableRootContext)
  const { setNodeRef } = useDroppable({
    id,
    disabled: disabled || !drop,
    data: { role: dropTargetRole, targetId, dropPriority },
  })
  const dragMode = dragState?.mode ?? null
  const overId = dragState?.overId ?? null
  const overTargetId = dragState?.overTargetId ?? null
  const activeId = dragState?.activeId ?? ''
  const isDropMode = dragMode === 'drop'
  const isDropCandidate = !!activeId && isDropMode && !!drop?.canDrop(activeId, targetId)
  const isDropTarget = isDropCandidate && overTargetId === targetId

  return (
    <>
      {children({
        setNodeRef,
        dragMode,
        overId,
        isDropCandidate,
        isDropTarget,
        shouldSuppressClick: () => shouldSuppressClick(id) || shouldSuppressClick(targetId),
      })}
    </>
  )
}

export function SortableDragStatus(props: SortableDragStatusProps) {
  const { children } = props
  const { dragState } = React.useContext(SortableRootContext)
  const dragMode = dragState?.mode ?? null
  return (
    <>
      {children({
        dragMode,
        activeId: dragState?.activeId ?? '',
        overId: dragState?.overId ?? null,
        overTargetId: dragState?.overTargetId ?? null,
        isDragging: Boolean(dragState?.activeId),
        isDropMode: dragMode === 'drop',
      })}
    </>
  )
}

export { rectSortingStrategy, verticalListSortingStrategy }
