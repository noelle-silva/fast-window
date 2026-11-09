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

/**
 * 松手瞬间的位移快照。
 *
 * 数据是异步落盘的：松手时列表还拿不到新顺序，但拖拽位移会立刻消失。
 * 于是画面先弹回旧位置，等数据回来再跳到落点，松手处的两段跳就是这么来的。
 *
 * 这份快照把松手那一刻每个条目的位移与各段的条目签名都记下来，
 * 在数据落地之前继续沿用这些位移；数据落地的那次提交里再释放，
 * 让「顺序变化」和「位移归零」发生在同一帧绘制之前。
 */
export type SortableSettleSnapshot = {
  activeId: string
  /** 条目 id → 松手时的位移值；没有位移的条目不在表里。 */
  transforms: ReadonlyMap<string, string>
  /** 段落 id → 松手时的条目签名，用来判断数据是否已经落地。 */
  sections: ReadonlyMap<string, string>
}

/** 条目顺序的紧凑签名：只关心顺序是否变化，不关心数组引用。 */
function itemsSignature(items: readonly string[]): string {
  return items.join('\u0000')
}

/** 数据是否已经落地：任一段落的条目顺序与松手时不同，就说明列表拿到了新顺序。 */
export function settleHasLanded(
  settle: SortableSettleSnapshot,
  sectionItems: ReadonlyMap<string, readonly string[]>,
): boolean {
  for (const [id, signature] of settle.sections) {
    if (itemsSignature(sectionItems.get(id) ?? []) !== signature) return true
  }
  return false
}

/**
 * 排序行的位移样式：拖拽中给让位位移，松手后沿用快照里的位移，
 * 直到数据落地再交还给 dnd-kit（此时 DOM 已经是新顺序）。
 */
export function resolveSortableItemStyle(args: {
  id: string
  isDragging: boolean
  isDropMode: boolean
  transform: string
  transition?: string
  settle: SortableSettleSnapshot | null
}): React.CSSProperties {
  const { id, isDragging, isDropMode, transform, transition, settle } = args
  const settleTransform = settle?.transforms.get(id)
  const settling = !isDragging && settleTransform !== undefined
  // 放置模式下这一行不参与让位：列表保持原位，只有目标行高亮。
  const resting = isDropMode && !isDragging
  return {
    transform: settling ? settleTransform : resting ? undefined : transform || undefined,
    transition: settling || resting ? undefined : transition,
    // 冻结中的活动行仍压在最上层，避免它与相邻行重叠时被盖住。
    zIndex: isDragging || (settling && settle?.activeId === id) ? 2 : undefined,
  }
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
  settle: SortableSettleSnapshot | null
  shouldSuppressClick: (id: string) => boolean
  /** 条目每次提交渲染时登记自己的实时位移，供松手时抓一份快照。 */
  trackItemTransform: (id: string, transform: string) => void
  /** 段落登记自己的条目顺序；传 null 表示段落已卸载。 */
  trackSectionItems: (id: string, items: readonly string[] | null) => void
}

const sortableItemRole = 'sortable-item'
const dropTargetRole = 'drop-target'
/** 拖拽结束后浏览器仍会补发 click：在这段时间内忽略相关行的点击。 */
const clickSuppressionMs = 260
/**
 * 冻结位移的最长保留时间。
 * 正常路径由「条目顺序变化」结束冻结；保存失败或顺序没有变化时，
 * 由这个上限把画面交还给真实数据，避免位移一直挂着。
 */
const settleTimeoutMs = 600

const SortableRootContext = React.createContext<SortableRootContextValue>({
  dragState: null,
  drop: null,
  settle: null,
  shouldSuppressClick: () => false,
  trackItemTransform: () => {},
  trackSectionItems: () => {},
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
  // 拖拽结束到数据落地之间的位移冻结，细节见 SortableSettleSnapshot。
  const [settle, setSettle] = React.useState<SortableSettleSnapshot | null>(null)
  const itemTransformsRef = React.useRef(new Map<string, string>())
  const sectionItemsRef = React.useRef(new Map<string, readonly string[]>())
  const settleTimerRef = React.useRef<number | null>(null)
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

  const trackItemTransform = React.useCallback((id: string, transform: string) => {
    if (transform) itemTransformsRef.current.set(id, transform)
    else itemTransformsRef.current.delete(id)
  }, [])

  const trackSectionItems = React.useCallback((id: string, items: readonly string[] | null) => {
    if (items) sectionItemsRef.current.set(id, items)
    else sectionItemsRef.current.delete(id)
  }, [])

  const clearSettleTimer = React.useCallback(() => {
    if (settleTimerRef.current === null) return
    window.clearTimeout(settleTimerRef.current)
    settleTimerRef.current = null
  }, [])

  const releaseSettle = React.useCallback(() => {
    clearSettleTimer()
    setSettle(null)
  }, [clearSettleTimer])

  /** 提交前抓一份松手快照：此刻读到的位移与条目顺序都还是拖拽中的那一份。 */
  const beginSettle = React.useCallback(
    (activeId: string) => {
      const sections = new Map<string, string>()
      for (const [id, items] of sectionItemsRef.current) sections.set(id, itemsSignature(items))
      setSettle({ activeId, transforms: new Map(itemTransformsRef.current), sections })
      clearSettleTimer()
      settleTimerRef.current = window.setTimeout(() => {
        settleTimerRef.current = null
        setSettle(null)
      }, settleTimeoutMs)
    },
    [clearSettleTimer],
  )

  // 数据落地后的那次提交里释放冻结：此时 DOM 已是新顺序，位移归零不会再把行拉回旧位置。
  // 放在 layout effect 里，与绘制同帧完成，不会露出一帧的中间状态。
  React.useLayoutEffect(() => {
    if (!settle) return
    if (settleHasLanded(settle, sectionItemsRef.current)) releaseSettle()
  })

  React.useEffect(() => {
    return () => {
      if (suppressTimerRef.current !== null) window.clearTimeout(suppressTimerRef.current)
      if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current)
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
      // 上一轮冻结如果还挂着（数据迟迟没落地），新一次拖拽从真实数据重新开始。
      releaseSettle()
      setCurrentDragState({
        activeId,
        overId: null,
        overTargetId: null,
        mode: resolveSortableDragMode(dropEnabled && hasCtrlKey(event.activatorEvent)),
      })
      onDragStart?.()
    },
    [dropEnabled, onDragStart, releaseSettle, setCurrentDragState],
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
        if (targetId !== null && drop?.canDrop(activeId, targetId)) {
          beginSettle(activeId)
          drop.onDrop(activeId, targetId)
        }
        return
      }
      if (!overId || activeId === overId) return
      beginSettle(activeId)
      onMove(activeId, overId)
    },
    [beginSettle, drop, onDragStop, onMove, setCurrentDragState, suppressClick],
  )

  const handleDragCancel = React.useCallback(() => {
    const activeId = dragStateRef.current?.activeId ?? ''
    setCurrentDragState(null)
    releaseSettle()
    if (activeId) suppressClick(activeId)
    onDragStop?.()
  }, [onDragStop, releaseSettle, setCurrentDragState, suppressClick])

  const contextValue = React.useMemo<SortableRootContextValue>(
    () => ({ dragState, drop, settle, shouldSuppressClick, trackItemTransform, trackSectionItems }),
    [dragState, drop, settle, shouldSuppressClick, trackItemTransform, trackSectionItems],
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
  const { trackSectionItems } = React.useContext(SortableRootContext)
  const sectionId = React.useId()
  // 登记本段当前的条目顺序：松手快照与落地判定都以此为准。
  React.useLayoutEffect(() => {
    trackSectionItems(sectionId, items)
    return () => trackSectionItems(sectionId, null)
  }, [items, sectionId, trackSectionItems])
  return (
    <SortableContext items={items} strategy={strategy}>
      {children}
    </SortableContext>
  )
}

export function SortableItem(props: SortableItemProps) {
  const { id, disabled = false, dropTargetId, children } = props
  const { dragState, drop, settle, shouldSuppressClick, trackItemTransform } =
    React.useContext(SortableRootContext)
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

  const transformText = CSS.Transform.toString(transform) ?? ''
  // 位移登记放在提交之后：onDragEnd 抓快照时读到的仍是拖拽中的那份值。
  React.useLayoutEffect(() => {
    trackItemTransform(id, transformText)
    return () => trackItemTransform(id, '')
  }, [id, trackItemTransform, transformText])

  // 数据还没落地时沿用松手瞬间的位移：否则位移会先归零把行弹回旧位置，数据回来再跳一次。
  const style = React.useMemo<React.CSSProperties>(
    () => resolveSortableItemStyle({ id, isDragging, isDropMode, transform: transformText, transition, settle }),
    [id, isDragging, isDropMode, settle, transformText, transition],
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
