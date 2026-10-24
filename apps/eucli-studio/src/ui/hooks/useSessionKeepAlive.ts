import * as React from 'react'
import {
  SESSION_KEEP_ALIVE_LIMIT,
  sameSessionKeepAliveOrder,
  touchSessionKeepAliveOrder,
} from '../../domain/sessionKeepAlive'

// 只维护“会话页面常驻顺序”，不持有会话数据本身。
// 页面节点由 SessionPageStack 按顺序保留，超出上限的尾部页面自然卸载。
export function useSessionKeepAlive(sessionKey: string, limit = SESSION_KEEP_ALIVE_LIMIT): string[] {
  const key = String(sessionKey || '').trim()
  const [order, setOrder] = React.useState<string[]>(() => touchSessionKeepAliveOrder([], key, limit))
  const keys = React.useMemo(() => touchSessionKeepAliveOrder(order, key, limit), [order, key, limit])

  React.useLayoutEffect(() => {
    setOrder((prev) => {
      const next = touchSessionKeepAliveOrder(prev, key, limit)
      return sameSessionKeepAliveOrder(prev, next) ? prev : next
    })
  }, [key, limit])

  return keys
}
