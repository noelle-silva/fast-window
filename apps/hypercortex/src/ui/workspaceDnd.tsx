import * as React from 'react'
import {
  DndContext,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import type { FavoritesForeignPayload } from './useFavoritesSidebarDnd'

// 左右两侧共用一个 dnd-kit 拖拽上下文：左侧条目拖入右侧后，由右侧原生拖拽机制接管。
// 为保持顺滑：可放置位置只在拖拽期测量（非活动侧不注册）；碰撞只在指针所在侧计算；
// 指针不在且非拖拽来源的一侧走静态渲染、不订阅上下文；跨栏路由只在真正跨越时更新。

/** 列表容器上的侧标记：宿主据此判定指针当前所在侧。 */
export const DND_SIDE_ATTR = 'data-hc-dnd-side'

type Side = 'left' | 'right' | ''

export type WorkspaceDndSides = {
  dragging: boolean
  pointerSide: Side
  originSide: Side
}

const WorkspaceDndSideContext = React.createContext<WorkspaceDndSides>({ dragging: false, pointerSide: '', originSide: '' })

/** 读取当前拖拽的侧状态：用于面板决定本侧是否参与拖拽渲染。 */
export function useWorkspaceDndSides(): WorkspaceDndSides {
  return React.useContext(WorkspaceDndSideContext)
}

export type WorkspaceDndParticipant = {
  /** 是否拥有该拖拽标识（仅左侧需要；右侧承接一切非左侧标识）。 */
  owns?: (id: string) => boolean
  onDragStart: (activeId: string, event: DragStartEvent) => void
  onDragOver: (activeId: string, overId: string, event: DragOverEvent) => void
  onDragEnd: (activeId: string, overId: string, event: DragEndEvent) => void
  onDragCancel: () => void
  /** 左侧专有：解析被拖拽条目的收藏载荷，供跨栏接管。 */
  getDragPayload?: (activeId: string) => FavoritesForeignPayload | null
  /** 左侧专有：指针进入右侧时停止本侧排序预览。 */
  onCrossLeave?: () => void
  /** 右侧专有：接管左侧条目（首个进入事件，后续移动复用 onForeignEnter）。 */
  onForeignEnter?: (payload: FavoritesForeignPayload, overId: string, modifierHeld: boolean) => void
  /** 右侧专有：条目离开右侧，结束接管。 */
  onForeignLeave?: () => void
  /** 右侧专有：在右侧松手，提交落点。 */
  onForeignDrop?: (overId: string) => void
}

type RegisterFn = (role: 'left' | 'right', participant: WorkspaceDndParticipant | null) => void

const WorkspaceDndRegisterContext = React.createContext<RegisterFn | null>(null)

/** 面板注册自身的拖拽参与者：左右共用一个拖拽上下文。 */
export function useWorkspaceDndParticipant(role: 'left' | 'right', participant: WorkspaceDndParticipant): void {
  const register = React.useContext(WorkspaceDndRegisterContext)
  const participantRef = React.useRef(participant)
  participantRef.current = participant

  React.useEffect(() => {
    if (!register) return
    // 稳定的转发器：事件发生时始终调用最新一次渲染的参与者实现。
    const forward: WorkspaceDndParticipant = {
      owns: id => participantRef.current.owns?.(id) ?? false,
      onDragStart: (activeId, event) => participantRef.current.onDragStart(activeId, event),
      onDragOver: (activeId, overId, event) => participantRef.current.onDragOver(activeId, overId, event),
      onDragEnd: (activeId, overId, event) => participantRef.current.onDragEnd(activeId, overId, event),
      onDragCancel: () => participantRef.current.onDragCancel(),
      getDragPayload: activeId => participantRef.current.getDragPayload?.(activeId) ?? null,
      onCrossLeave: () => participantRef.current.onCrossLeave?.(),
      onForeignEnter: (payload, overId, modifierHeld) => participantRef.current.onForeignEnter?.(payload, overId, modifierHeld),
      onForeignLeave: () => participantRef.current.onForeignLeave?.(),
      onForeignDrop: overId => participantRef.current.onForeignDrop?.(overId),
    }
    register(role, forward)
    return () => register(role, null)
  }, [register, role])
}

function readModifier(event: DragStartEvent): boolean {
  const activator = event.activatorEvent
  const keyed = activator && 'ctrlKey' in activator ? (activator as KeyboardEvent | MouseEvent) : null
  return !!keyed && (!!keyed.ctrlKey || !!keyed.metaKey)
}

function pointerFromMoveEvent(event: DragMoveEvent): { x: number; y: number } | null {
  const activator = event.activatorEvent
  if (!activator || !('clientX' in activator)) return null
  const point = activator as MouseEvent
  return { x: point.clientX + event.delta.x, y: point.clientY + event.delta.y }
}

/** 按指针坐标判定其当前所在侧；不在任一侧标记内时返回空串。 */
function readSideAt(clientX: number, clientY: number): Side {
  const hit = document.elementFromPoint(clientX, clientY)
  const host = hit instanceof Element ? hit.closest(`[${DND_SIDE_ATTR}]`) : null
  const side = host?.getAttribute(DND_SIDE_ATTR)
  return side === 'left' || side === 'right' ? side : ''
}

export function WorkspaceDndProvider(props: { children: React.ReactNode }) {
  const registry = React.useRef<{ left: WorkspaceDndParticipant | null; right: WorkspaceDndParticipant | null }>({
    left: null,
    right: null,
  })
  const register = React.useCallback<RegisterFn>((role, participant) => {
    registry.current[role] = participant
  }, [])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const [sides, setSides] = React.useState<WorkspaceDndSides>({ dragging: false, pointerSide: '', originSide: '' })
  const sidesRef = React.useRef(sides)
  sidesRef.current = sides
  const modifierRef = React.useRef(false)

  const detachKeysRef = React.useRef<(() => void) | null>(null)
  const stopTrackingModifier = React.useCallback(() => {
    detachKeysRef.current?.()
    detachKeysRef.current = null
  }, [])

  const isLeftId = React.useCallback((id: string): boolean => !!id && !!registry.current.left?.owns?.(id), [])
  const ownerOf = React.useCallback(
    (id: string): WorkspaceDndParticipant | null => {
      if (!id) return null
      const { left, right } = registry.current
      return isLeftId(id) ? left : right
    },
    [isLeftId],
  )

  // 碰撞只在指针当前所在侧计算：排除另一侧的落点，避免两侧全扫。
  const collisionDetection = React.useCallback<CollisionDetection>(
    args => {
      const side = sidesRef.current.pointerSide
      if (!side) return closestCenter(args)
      const droppableContainers = args.droppableContainers.filter(c => (side === 'left') === isLeftId(String(c.id)))
      return closestCenter({ ...args, droppableContainers })
    },
    [isLeftId],
  )

  const handleDragStart = React.useCallback(
    (event: DragStartEvent) => {
      const activeId = String(event.active.id || '')
      if (!activeId) return
      const originSide: Side = isLeftId(activeId) ? 'left' : 'right'
      setSides({ dragging: true, pointerSide: originSide, originSide })
      modifierRef.current = readModifier(event)

      // 拖拽期间实时跟踪修饰键：跨栏接管时把当前状态交给右侧，途中按/松 Ctrl 也准确。
      stopTrackingModifier()
      const onKey = (e: KeyboardEvent) => {
        modifierRef.current = !!e.ctrlKey || !!e.metaKey
      }
      window.addEventListener('keydown', onKey, true)
      window.addEventListener('keyup', onKey, true)
      detachKeysRef.current = () => {
        window.removeEventListener('keydown', onKey, true)
        window.removeEventListener('keyup', onKey, true)
      }

      ownerOf(activeId)?.onDragStart(activeId, event)
    },
    [isLeftId, ownerOf, stopTrackingModifier],
  )

  // 指针所在侧只在真正跨越时更新一次状态，不随每次移动刷新。
  const handleDragMove = React.useCallback((event: DragMoveEvent) => {
    const point = pointerFromMoveEvent(event)
    if (!point) return
    const side = readSideAt(point.x, point.y)
    if (!side || sidesRef.current.pointerSide === side) return
    setSides(prev => (prev.dragging ? { ...prev, pointerSide: side } : prev))
  }, [])

  const finishDrag = React.useCallback(() => {
    stopTrackingModifier()
    setSides({ dragging: false, pointerSide: '', originSide: '' })
  }, [stopTrackingModifier])

  const handleDragOver = React.useCallback(
    (event: DragOverEvent) => {
      const activeId = String(event.active.id || '')
      const overId = String(event.over?.id || '')
      if (!activeId) return
      const { left, right } = registry.current
      const activeOwner = ownerOf(activeId)
      if (!activeOwner) return

      if (activeOwner === left) {
        if (overId && !isLeftId(overId) && right) {
          const payload = left.getDragPayload?.(activeId) ?? null
          if (payload) {
            right.onForeignEnter?.(payload, overId, modifierRef.current)
            left.onCrossLeave?.()
            return
          }
        }
        right?.onForeignLeave?.()
        activeOwner.onDragOver(activeId, overId, event)
        return
      }

      activeOwner.onDragOver(activeId, overId, event)
    },
    [isLeftId, ownerOf],
  )

  const handleDragEnd = React.useCallback(
    (event: DragEndEvent) => {
      finishDrag()
      const activeId = String(event.active.id || '')
      const overId = String(event.over?.id || '')
      if (!activeId) return
      const { left, right } = registry.current
      const activeOwner = ownerOf(activeId)
      if (!activeOwner) return

      if (activeOwner === left) {
        if (overId && !isLeftId(overId) && right) {
          // 右侧落定后，左侧仅需清除自身拖拽激活态（落点与写入由右侧负责）。
          right.onForeignDrop?.(overId)
          left.onDragCancel()
          return
        }
        right?.onForeignLeave?.()
        left.onDragEnd(activeId, overId, event)
        return
      }

      activeOwner.onDragEnd(activeId, overId, event)
    },
    [finishDrag, isLeftId, ownerOf],
  )

  const handleDragCancel = React.useCallback(() => {
    finishDrag()
    registry.current.left?.onDragCancel()
    registry.current.right?.onForeignLeave?.()
  }, [finishDrag])

  React.useEffect(() => stopTrackingModifier, [stopTrackingModifier])

  return (
    <WorkspaceDndRegisterContext.Provider value={register}>
      <WorkspaceDndSideContext.Provider value={sides}>
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
      </WorkspaceDndSideContext.Provider>
    </WorkspaceDndRegisterContext.Provider>
  )
}
