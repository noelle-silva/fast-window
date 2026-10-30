import * as React from 'react'
import { Box } from '@mui/material'
import { markSwitchBoundary } from '../../domain/switchTrace'
import { SessionPageScrollContext, type SessionPageScrollRegistry } from './sessionPageScrollRegistry'

const PAGE_SX = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  minHeight: 0,
} as const

const CACHED_PAGE_SX = {
  ...PAGE_SX,
  visibility: 'hidden',
  pointerEvents: 'none',
} as const

// 待绘制的下一页：必须挂载并参与布局（否则拿不到首次绘制、也上报不了 PAINTED），
// 但绝不能可见——它与旧页都是 absolute inset:0，同时可见就会让两个会话的内容叠在一起。
// visibility 只影响绘制、不影响布局，因此这里隐藏的是「看得见」，不是「排得开」。
const PENDING_PAGE_SX = {
  ...PAGE_SX,
  visibility: 'hidden',
  pointerEvents: 'none',
} as const

const SessionPageActiveKeyContext = React.createContext<string | null>(null)
// 页面可见性契约：{ active, epoch }。
//   - active：本页是否真正在屏幕上且可交互；
//   - epoch：本页每次重新激活递增，供页面内调度判断「这是新一轮激活」。
// 这是页面内所有调度（分批上屏、屏外观察、范围订阅）的统一开关。
export type SessionPageVisibility = { active: boolean; epoch: number }
const SessionPageVisibilityContext = React.createContext<SessionPageVisibility>({ active: true, epoch: 0 })

export function useSessionPageActiveKey(): string | null {
  return React.useContext(SessionPageActiveKeyContext)
}

export function useSessionPageVisibility(): SessionPageVisibility {
  return React.useContext(SessionPageVisibilityContext)
}

export function useSessionPageVisible(): boolean {
  return React.useContext(SessionPageVisibilityContext).active
}

// inert 是第三态：节点保持像素与滚动位置，但不接收任何交互。
// React 18 的类型里没有 inert，用属性写入保持类型干净。
function setInert(el: HTMLElement | null, inert: boolean) {
  if (!el) return
  if (inert) el.setAttribute('inert', '')
  else el.removeAttribute('inert')
}

function SessionPageSlot(props: {
  pageState: 'active' | 'pending' | 'cached'
  onScreen: boolean
  inert: boolean
  visible: boolean
  zIndex: number
  sx: Record<string, unknown>
  children: React.ReactNode
}) {
  const { pageState, onScreen, inert, visible, zIndex, sx, children } = props
  const ref = React.useRef<HTMLDivElement | null>(null)
  // epoch 只在「从不可见变回可见」时递增：页面内调度据此区分新一轮激活。
  const [epoch, setEpoch] = React.useState(0)
  const wasVisibleRef = React.useRef(visible)
  React.useLayoutEffect(() => setInert(ref.current, inert), [inert])
  React.useLayoutEffect(() => {
    if (visible && !wasVisibleRef.current) setEpoch((value) => value + 1)
    wasVisibleRef.current = visible
  }, [visible])
  const visibility = React.useMemo<SessionPageVisibility>(() => ({ active: visible, epoch }), [visible, epoch])
  return (
    <Box
      ref={ref}
      data-fw-session-page={pageState}
      data-fw-session-onscreen={onScreen ? 'true' : 'false'}
      aria-hidden={inert ? true : undefined}
      sx={{ ...sx, zIndex }}
    >
      <SessionPageVisibilityContext.Provider value={visibility}>{children}</SessionPageVisibilityContext.Provider>
    </Box>
  )
}

// 会话页面栈：当前页面每次拿到新元素，缓存页面复用最后一次激活时的元素。
// 元素引用不变，React 会跳过该子树的调和，节点和内部状态（滚动、分批进度）原样保留；
// keys 之外的页面从栈中移除时才会真正卸载。
//
// 两层 key 严格分开：
//   - visibleKey：最后一次真正画出的页面，由 PAINTED 推进，负责「看得见谁」。
//   - activeKey：用户选中的页面，负责「正在装谁」。
// 切换期间两者不同：旧页保持像素不变、压在新页之上并交还交互权（inert）；
// 新页在旧页之下正常排版绘制，绘制完成（双 rAF）后再提升为可见页。
// 这样既没有空白帧，也没有「新页还没画好就顶掉旧页」的跳动。
export function SessionPageStack(props: {
  activeKey: string
  visibleKey: string
  keys: string[]
  activePage: React.ReactNode
  activeScrollRef?: React.MutableRefObject<HTMLDivElement | null>
  onPainted?: (key: string) => void
}) {
  const { activeKey, visibleKey: visibleKeyRaw, keys, activePage, activeScrollRef, onPainted } = props
  const pagesRef = React.useRef(new Map<string, React.ReactNode>())
  const slotOrderRef = React.useRef<string[]>([])
  const scrollElsRef = React.useRef(new Map<string, HTMLDivElement>())
  const activeKeyRef = React.useRef(activeKey)
  activeKeyRef.current = activeKey

  const registry = React.useMemo<SessionPageScrollRegistry>(
    () => ({
      register: (sessionKey, el) => {
        const key = String(sessionKey || '').trim()
        if (!key) return
        if (el) scrollElsRef.current.set(key, el)
        else scrollElsRef.current.delete(key)
        if (activeScrollRef && activeKeyRef.current === key) activeScrollRef.current = el
      },
    }),
    [activeScrollRef],
  )

  const pages = pagesRef.current
  if (activeKey && activePage && keys.includes(activeKey)) pages.set(activeKey, activePage)
  const retained = new Set(keys)
  for (const key of Array.from(pages.keys())) {
    if (!retained.has(key)) pages.delete(key)
  }

  // 槽位顺序按下标稳定保留：切换会话只改可见性，不搬动已缓存页面的大块 DOM。
  const slots = slotOrderRef.current
  for (let i = slots.length - 1; i >= 0; i--) {
    if (!retained.has(slots[i])) slots.splice(i, 1)
  }
  for (let i = keys.length - 1; i >= 0; i--) {
    const key = keys[i]
    if (!slots.includes(key)) slots.push(key)
  }

  // 可见页必须仍被保活；被淘汰的可见页视为无垫底。
  const visibleKey = visibleKeyRaw && keys.includes(visibleKeyRaw) ? visibleKeyRaw : ''
  // 没有旧页可垫底时（冷启动 / 上次失败 / 上次 empty），激活页必须立刻可见：
  // 此时页面上只有它一个，不存在叠影风险，也不该让用户等两帧白屏。
  const displayedKey = visibleKey || activeKey

  React.useLayoutEffect(() => {
    if (!activeScrollRef) return
    activeScrollRef.current = activeKey ? scrollElsRef.current.get(activeKey) || null : null
  }, [activeKey, keys.length, activeScrollRef])

  // 首次提交完成后再推进可见页：双 rAF 保证「画出来」而不是「挂上去」。
  // 同一 key 的重复通知由 reducer 去重；seq 不匹配的通知会被静默丢弃。
  React.useLayoutEffect(() => {
    if (!onPainted) return
    if (!activeKey || activeKey === visibleKey) return
    if (!pages.has(activeKey)) return
    markSwitchBoundary('frontend.pageMounted')
    let second = 0
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => onPainted(activeKey))
    })
    return () => {
      cancelAnimationFrame(first)
      cancelAnimationFrame(second)
    }
  }, [activeKey, visibleKey, keys.length, onPainted])

  return (
    <SessionPageScrollContext.Provider value={registry}>
      <SessionPageActiveKeyContext.Provider value={activeKey}>
        <Box sx={{ position: 'relative', flex: 1, minWidth: 0, minHeight: 0 }}>
          {slots.map((key) => {
            const isVisible = key === displayedKey
            const isActive = key === activeKey
            // 可交互页只有两种：可见且就是激活页，或冷启动无可见页时的激活页。
            // 没有激活页时（例如目标实体暂时缺失），旧页继续保持可交互，避免交互被凭空剥夺。
            const interactive = isVisible ? (!activeKey || isActive) : (isActive && !displayedKey)
            // 可调度页：可见页与正在装的新页都要干活（新页必须能完成首次绘制）；
            // 只有缓存页停掉全部调度。
            const schedulable = isVisible || isActive
            const pageState: 'active' | 'pending' | 'cached' = isVisible ? 'active' : isActive ? 'pending' : 'cached'
            // 旧页压在新页之上：新页在底下正常排版绘制，绘制完成才交换层级。
            // 关键：同一时刻只允许「一个可见页」。
            //   active  → 唯一可见；
            //   pending → 已挂载、参与布局、但 visibility:hidden（不叠影，且能完成首帧）；
            //   cached  → 隐藏且不参与调度。
            const zIndex = isVisible ? 2 : isActive ? 1 : 0
            const sx = isVisible ? PAGE_SX : isActive ? PENDING_PAGE_SX : CACHED_PAGE_SX
            return (
              <SessionPageSlot
                key={key}
                pageState={pageState}
                onScreen={isVisible}
                inert={!interactive}
                visible={schedulable}
                zIndex={zIndex}
                sx={sx}
              >
                {pages.get(key)}
              </SessionPageSlot>
            )
          })}
        </Box>
      </SessionPageActiveKeyContext.Provider>
    </SessionPageScrollContext.Provider>
  )
}
