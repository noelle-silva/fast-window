import * as React from 'react'
import {
  DndContext,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'

// 左右两侧共用一个 dnd-kit 拖拽上下文。
// 「哪一侧」完全交给 dnd-kit：两侧面板各注册为一个带 side 的 droppable 容器，
// 指针命中哪个容器，条目当前就属于哪一侧（跨栏即条目从一个容器移动到另一个容器）。
// 因此不再有 DOM 属性/矩形/可见性扫描，也不再有手算指针坐标。
// 为保持顺滑：可放置位置只在拖拽期测量；碰撞只在指针所在容器内计算；非活动侧静态不订阅上下文。

export type WorkspaceSide = 'left' | 'right'

/** 跨栏载荷：条目从一个容器移动到另一个容器时携带的身份与业务信息。 */
export type WorkspaceTransferItem = {
  /** 条目原始拖拽标识；跨栏后以同一身份加入目标容器。 */
  id: string
  kind: 'note' | 'asset'
  targetId: string
}

/** 左右两侧共用的一套对称参与者接口。 */
export type WorkspaceDndParticipant = {
  /** 本容器是否拥有该条目。 */
  ownsItem: (id: string) => boolean
  /** 描述可迁出本容器的条目；返回空表示该条目不能离开本容器。 */
  describeTransfer?: (activeId: string) => WorkspaceTransferItem | null
  onDragStart: (activeId: string) => void
  onDragOver: (activeId: string, overId: string) => void
  onDragEnd: (activeId: string, overId: string) => void
  onDragCancel: () => void
}

/** 拖拽状态：pointerSide 是指针所在容器（含空白区域），activeSide 是条目当前所属容器，originSide 是拖拽起点容器。 */
export type WorkspaceDndState = {
  dragging: boolean
  /** 指针所在容器：指针在两侧之间时保留上一次所在容器。 */
  pointerSide: WorkspaceSide | ''
  /** 条目当前所属容器。 */
  activeSide: WorkspaceSide | ''
  originSide: WorkspaceSide | ''
  activeId: string
  /** 跨栏时条目当前所属容器之外的载荷（供目标容器以同一身份呈现）；本栏内拖拽为空。 */
  activeItem: WorkspaceTransferItem | null
}

const EMPTY_STATE: WorkspaceDndState = { dragging: false, pointerSide: '', activeSide: '', originSide: '', activeId: '', activeItem: null }

const WorkspaceDndStateContext = React.createContext<WorkspaceDndState>(EMPTY_STATE)
const WorkspaceDndModifierContext = React.createContext(false)
const WorkspaceDndRegisterContext = React.createContext<RegisterFn | null>(null)

/** 读取当前拖拽状态：用于面板决定本侧是否参与拖拽渲染、以及条目当前所属容器。 */
export function useWorkspaceDnd(): WorkspaceDndState {
  return React.useContext(WorkspaceDndStateContext)
}

/** 读取拖拽期间的修饰键状态：单一来源，供需要它的容器使用。 */
export function useWorkspaceDndModifier(): boolean {
  return React.useContext(WorkspaceDndModifierContext)
}

type RegisterFn = (side: WorkspaceSide, participant: WorkspaceDndParticipant | null) => void

/** 面板注册自身的拖拽参与者：左右同一套接口。 */
export function useWorkspaceDndParticipant(side: WorkspaceSide, participant: WorkspaceDndParticipant): void {
  const register = React.useContext(WorkspaceDndRegisterContext)
  const participantRef = React.useRef(participant)
  participantRef.current = participant

  React.useEffect(() => {
    if (!register) return
    // 稳定的转发器：事件发生时始终调用最新一次渲染的参与者实现。
    const forward: WorkspaceDndParticipant = {
      ownsItem: id => participantRef.current.ownsItem(id),
      describeTransfer: id => participantRef.current.describeTransfer?.(id) ?? null,
      onDragStart: activeId => participantRef.current.onDragStart(activeId),
      onDragOver: (activeId, overId) => participantRef.current.onDragOver(activeId, overId),
      onDragEnd: (activeId, overId) => participantRef.current.onDragEnd(activeId, overId),
      onDragCancel: () => participantRef.current.onDragCancel(),
    }
    register(side, forward)
    return () => register(side, null)
  }, [register, side])
}

const WORKSPACE_SIDE_DROPPABLE_PREFIX = 'workspace-side:'

/** 把面板注册为带 side 的 droppable 容器：指针命中即得当前侧，无需任何坐标判定。 */
export function useWorkspaceSideContainer(side: WorkspaceSide): (node: HTMLElement | null) => void {
  const { setNodeRef } = useDroppable({ id: `${WORKSPACE_SIDE_DROPPABLE_PREFIX}${side}`, data: { workspaceSide: side } })
  return setNodeRef
}

/** 条目当前所属容器：跨栏成立时归指针所在容器，否则留在起点容器。 */
export function resolveActiveSide(params: {
  originSide: WorkspaceSide
  pointerSide: WorkspaceSide | ''
  canTransfer: boolean
}): WorkspaceSide {
  return params.canTransfer && params.pointerSide && params.pointerSide !== params.originSide ? params.pointerSide : params.originSide
}

/** 某侧是否参与拖拽渲染：拖拽中，指针所在侧与拖拽来源侧都参与（指针一进入即参与，含无条目的空白区域）。 */
export function isSideEngaged(params: {
  dragging: boolean
  pointerSide: WorkspaceSide | ''
  originSide: WorkspaceSide | ''
  side: WorkspaceSide
}): boolean {
  return !params.dragging || params.pointerSide === params.side || params.originSide === params.side
}

function readModifier(event: DragStartEvent): boolean {
  const activator = event.activatorEvent
  const keyed = activator && 'ctrlKey' in activator ? (activator as KeyboardEvent | MouseEvent) : null
  return !!keyed && (!!keyed.ctrlKey || !!keyed.metaKey)
}

export function WorkspaceDndProvider(props: { children: React.ReactNode }) {
  const registry = React.useRef<Record<WorkspaceSide, WorkspaceDndParticipant | null>>({ left: null, right: null })
  const register = React.useCallback<RegisterFn>((side, participant) => {
    registry.current[side] = participant
  }, [])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const [state, setState] = React.useState<WorkspaceDndState>(EMPTY_STATE)
  const stateRef = React.useRef(state)
  stateRef.current = state
  const [modifierHeld, setModifierHeld] = React.useState(false)
  const originSideRef = React.useRef<WorkspaceSide | ''>('')
  // pointerSide 为「当前所属容器」判定用：指针在两侧之间（面板之外）时保留上一次所在侧，避免跨栏中途反复进出。
  const pointerSideRef = React.useRef<WorkspaceSide | ''>('')
  // releaseSide 为松手归属用：每次碰撞都刷新，指针不在任一侧时即为空，用于「停在中间松手取消」。
  const releaseSideRef = React.useRef<WorkspaceSide | ''>('')
  const detachKeysRef = React.useRef<(() => void) | null>(null)

  const stopTrackingModifier = React.useCallback(() => {
    detachKeysRef.current?.()
    detachKeysRef.current = null
  }, [])

  const setModifier = React.useCallback((held: boolean) => {
    setModifierHeld(held)
  }, [])

  const updateState = React.useCallback((next: WorkspaceDndState) => {
    stateRef.current = next
    setState(next)
  }, [])

  const participantFor = React.useCallback((side: WorkspaceSide | ''): WorkspaceDndParticipant | null => {
    return side === 'left' || side === 'right' ? registry.current[side] : null
  }, [])

  const ownerSideOf = React.useCallback((id: string): WorkspaceSide | '' => {
    if (!id) return ''
    if (registry.current.left?.ownsItem(id)) return 'left'
    if (registry.current.right?.ownsItem(id)) return 'right'
    return ''
  }, [])

  // 用 dnd-kit 的指针命中判定当前侧：面板容器即 droppable，指针落在哪个容器就是哪一侧。
  // 条目碰撞只在该容器内计算：非活动侧不参与；跨栏条目以其当前所属容器为准参与碰撞，右侧原生让位自然成立。
  const collisionDetection = React.useCallback<CollisionDetection>(
    args => {
      const sideContainers = args.droppableContainers.filter(c => c.data.current?.workspaceSide)
      const hits = pointerWithin({ ...args, droppableContainers: sideContainers })
      const freshSide = (hits[0]?.data?.droppableContainer.data.current?.workspaceSide ?? '') as WorkspaceSide | ''
      releaseSideRef.current = freshSide
      if (freshSide) pointerSideRef.current = freshSide
      const pointerSide = pointerSideRef.current

      const activeId = String(args.active.id)
      const originSide = originSideRef.current
      const activeCanTransfer = !!participantFor(originSide)?.describeTransfer?.(activeId)
      const target = participantFor(pointerSide)
      const items = args.droppableContainers.filter(c => {
        if (c.data.current?.workspaceSide) return false
        if (!target) return false
        const id = String(c.id)
        if (id === activeId) return pointerSide === originSide || activeCanTransfer
        return target.ownsItem(id)
      })
      return closestCenter({ ...args, droppableContainers: items })
    },
    [participantFor],
  )

  const handleDragStart = React.useCallback(
    (event: DragStartEvent) => {
      const activeId = String(event.active.id || '')
      const originSide = ownerSideOf(activeId)
      if (!activeId || !originSide) return
      originSideRef.current = originSide
      pointerSideRef.current = originSide
      releaseSideRef.current = originSide
      updateState({ dragging: true, pointerSide: originSide, activeSide: originSide, originSide, activeId, activeItem: null })

      setModifier(readModifier(event))
      stopTrackingModifier()
      const onKey = (e: KeyboardEvent) => setModifier(!!e.ctrlKey || !!e.metaKey)
      window.addEventListener('keydown', onKey, true)
      window.addEventListener('keyup', onKey, true)
      detachKeysRef.current = () => {
        window.removeEventListener('keydown', onKey, true)
        window.removeEventListener('keyup', onKey, true)
      }

      participantFor(originSide)?.onDragStart(activeId)
    },
    [ownerSideOf, participantFor, setModifier, stopTrackingModifier, updateState],
  )

  const currentOriginSide = React.useCallback((): WorkspaceSide | null => {
    const side = originSideRef.current
    return side === 'left' || side === 'right' ? side : null
  }, [])

  // 依指针所在容器同步「指针侧 / 条目所属容器」：指针一进入某容器即生效（含无条目的空白区域），
  // 不依赖碰撞目标是否变化，因此空白区域同样进入该侧排序。
  const syncSideState = React.useCallback(() => {
    const current = stateRef.current
    if (!current.dragging) return
    const originSide = current.originSide
    if (originSide !== 'left' && originSide !== 'right') return
    const pointerSide = pointerSideRef.current
    const source = participantFor(originSide)
    const canTransfer = !!pointerSide && pointerSide !== originSide && !!source?.describeTransfer?.(current.activeId) && !!participantFor(pointerSide)
    const activeSide = resolveActiveSide({ originSide, pointerSide, canTransfer })
    if (current.pointerSide === pointerSide && current.activeSide === activeSide) return
    updateState({ ...current, pointerSide, activeSide, activeItem: canTransfer ? source?.describeTransfer?.(current.activeId) ?? null : null })
  }, [participantFor, updateState])

  const handleDragMove = React.useCallback(() => {
    syncSideState()
  }, [syncSideState])

  const handleDragOver = React.useCallback(
    (event: DragOverEvent) => {
      const activeId = String(event.active.id || '')
      const overId = String(event.over?.id || '')
      if (!activeId) return
      syncSideState()
      const activeSide = stateRef.current.activeSide
      if (activeSide !== 'left' && activeSide !== 'right') return
      participantFor(activeSide)?.onDragOver(activeId, overId)
    },
    [participantFor, syncSideState],
  )

  const finishDrag = React.useCallback(() => {
    stopTrackingModifier()
    setModifier(false)
    originSideRef.current = ''
    pointerSideRef.current = ''
    releaseSideRef.current = ''
    updateState(EMPTY_STATE)
  }, [setModifier, stopTrackingModifier, updateState])

  const handleDragEnd = React.useCallback(
    (event: DragEndEvent) => {
      const activeId = String(event.active.id || '')
      const overId = String(event.over?.id || '')
      const originSide = currentOriginSide()
      const source = originSide ? participantFor(originSide) : null
      const releaseSide = releaseSideRef.current
      const crossed = !!source && !!originSide && !!releaseSide && releaseSide !== originSide && !!source.describeTransfer?.(activeId)
      finishDrag()
      if (!activeId || !source || !originSide) return
      if (crossed) {
        // 条目在目标容器松手：目标容器提交落点，来源容器仅清除自身拖拽激活态。
        participantFor(releaseSide)?.onDragEnd(activeId, overId)
        source.onDragCancel()
      } else {
        source.onDragEnd(activeId, overId)
      }
    },
    [currentOriginSide, finishDrag, participantFor],
  )

  const handleDragCancel = React.useCallback(() => {
    const originSide = currentOriginSide()
    const source = originSide ? participantFor(originSide) : null
    finishDrag()
    source?.onDragCancel()
  }, [currentOriginSide, finishDrag, participantFor])

  React.useEffect(() => stopTrackingModifier, [stopTrackingModifier])

  return (
    <WorkspaceDndRegisterContext.Provider value={register}>
      <WorkspaceDndStateContext.Provider value={state}>
        <WorkspaceDndModifierContext.Provider value={modifierHeld}>
          <DndContext
            sensors={sensors}
            collisionDetection={collisionDetection}
            measuring={{ droppable: { strategy: MeasuringStrategy.WhileDragging } }}
            onDragStart={handleDragStart}
            onDragMove={handleDragMove}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            {props.children}
          </DndContext>
        </WorkspaceDndModifierContext.Provider>
      </WorkspaceDndStateContext.Provider>
    </WorkspaceDndRegisterContext.Provider>
  )
}
