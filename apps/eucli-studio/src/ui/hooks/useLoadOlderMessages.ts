import * as React from 'react'

// 往上翻页的唯一触发器：滚动到顶部附近时请求更早的一窗。
//
// 三条约束：
//   1. 单飞：一次请求在途时不再触发（滚动事件很密集）；
//   2. 有终点：后端返回「没有更多」后本会话不再重复请求；
//   3. 会话换代即重置：切换会话后重新允许翻页。
//
// 翻页会在列表**顶部**插入内容。浏览器不会自动保住视口，
// 所以这里在请求前后用 scrollHeight 差值把视口钉在原处，
// 否则每翻一页画面都会往下跳一屏。
export function useLoadOlderMessages(deps: { controller: any; sessionKey: string }) {
  const pendingRef = React.useRef(false)
  const exhaustedRef = React.useRef(false)
  const sessionRef = React.useRef(deps.sessionKey)
  if (sessionRef.current !== deps.sessionKey) {
    sessionRef.current = deps.sessionKey
    exhaustedRef.current = false
    pendingRef.current = false
  }

  return React.useCallback(
    (el: HTMLDivElement) => {
      if (!el || !deps.sessionKey) return
      if (exhaustedRef.current || pendingRef.current) return
      // 只在真正接近顶部时才请求：离开顶部后的滚动事件一律忽略。
      if (el.scrollTop > 64) return
      const action = deps.controller?.actions?.loadOlderMessages
      if (typeof action !== 'function') return
      pendingRef.current = true
      const beforeHeight = el.scrollHeight
      Promise.resolve(action())
        .then((loaded: unknown) => {
          if (loaded !== true) {
            exhaustedRef.current = true
            return
          }
          // 等这次 emit 的 DOM 提交落地，再按高度差补偿视口。
          requestAnimationFrame(() => {
            const delta = el.scrollHeight - beforeHeight
            if (delta > 0) el.scrollTop += delta
          })
        })
        .catch(() => {})
        .finally(() => {
          pendingRef.current = false
        })
    },
    [deps.controller, deps.sessionKey],
  )
}
