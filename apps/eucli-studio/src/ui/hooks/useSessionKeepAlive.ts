import * as React from 'react'
import {
  SESSION_KEEP_ALIVE_LIMIT,
  normalizeSessionKeepAliveLimit,
  sameSessionKeepAliveOrder,
  touchSessionKeepAliveOrder,
} from '../../domain/sessionKeepAlive'

// 只维护“会话页面常驻顺序”，不持有会话数据本身。
// 页面节点由 SessionPageStack 按顺序保留，超出上限的尾部页面自然卸载。
//
// limit 可配置（设置项），pinnedKey 是当前可见页：切换期间它必须留在栈里，
// 否则新页绘制完成前会出现「旧页已卸载、新页还没画」的空白帧。
export function useSessionKeepAlive(
  sessionKey: string,
  options?: { limit?: unknown; pinnedKey?: string },
): string[] {
  const key = String(sessionKey || '').trim()
  const limit = normalizeSessionKeepAliveLimit(options?.limit ?? SESSION_KEEP_ALIVE_LIMIT)
  const pinnedKey = String(options?.pinnedKey || '').trim()
  const [order, setOrder] = React.useState<string[]>(() => touchSessionKeepAliveOrder([], key, limit, pinnedKey))
  const keys = React.useMemo(
    () => touchSessionKeepAliveOrder(order, key, limit, pinnedKey),
    [order, key, limit, pinnedKey],
  )

  React.useLayoutEffect(() => {
    setOrder((prev) => {
      const next = touchSessionKeepAliveOrder(prev, key, limit, pinnedKey)
      return sameSessionKeepAliveOrder(prev, next) ? prev : next
    })
  }, [key, limit, pinnedKey])

  return keys
}
