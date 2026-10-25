import * as React from 'react'
import { Box } from '@mui/material'
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

const SessionPageActiveKeyContext = React.createContext<string | null>(null)

export function useSessionPageActiveKey(): string | null {
  return React.useContext(SessionPageActiveKeyContext)
}

// 会话页面栈：当前页面每次拿到新元素，缓存页面复用最后一次激活时的元素。
// 元素引用不变，React 会跳过该子树的调和，节点和内部状态（滚动、分批进度）原样保留；
// keys 之外的页面从栈中移除时才会真正卸载。
export function SessionPageStack(props: {
  activeKey: string
  keys: string[]
  activePage: React.ReactNode
  activeScrollRef?: React.MutableRefObject<HTMLDivElement | null>
}) {
  const { activeKey, keys, activePage, activeScrollRef } = props
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

  React.useLayoutEffect(() => {
    if (!activeScrollRef) return
    activeScrollRef.current = activeKey ? scrollElsRef.current.get(activeKey) || null : null
  }, [activeKey, keys.length, activeScrollRef])

  return (
    <SessionPageScrollContext.Provider value={registry}>
      <SessionPageActiveKeyContext.Provider value={activeKey}>
        <Box sx={{ position: 'relative', flex: 1, minWidth: 0, minHeight: 0 }}>
          {slots.map((key) => {
            const active = key === activeKey
            return (
              <Box
                key={key}
                data-fw-session-page={active ? 'active' : 'cached'}
                aria-hidden={active ? undefined : true}
                sx={active ? PAGE_SX : CACHED_PAGE_SX}
              >
                {pages.get(key)}
              </Box>
            )
          })}
        </Box>
      </SessionPageActiveKeyContext.Provider>
    </SessionPageScrollContext.Provider>
  )
}
