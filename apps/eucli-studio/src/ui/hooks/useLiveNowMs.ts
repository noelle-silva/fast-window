import * as React from 'react'

// 运行中的秒表共用同一条高频节拍：节拍粒度与耗时的显示精度对齐（0.1 秒），
// 让小数位持续滚动；没有订阅者时自动停表，不给闲置界面留后台定时器，
// 也不产生任何数据请求。
const LIVE_TICK_MS = 100
const liveTickListeners = new Set<() => void>()
let liveTickTimer = 0

function subscribeLiveTick(listener: () => void) {
  liveTickListeners.add(listener)
  if (!liveTickTimer) {
    liveTickTimer = window.setInterval(() => {
      for (const notify of Array.from(liveTickListeners)) notify()
    }, LIVE_TICK_MS)
  }
  return () => {
    liveTickListeners.delete(listener)
    if (!liveTickListeners.size && liveTickTimer) {
      window.clearInterval(liveTickTimer)
      liveTickTimer = 0
    }
  }
}

// useLiveNowMs 在 active 期间跟随节拍重渲染，并返回当下的墙钟毫秒；
// 停用时返回 0，且不保留任何订阅。
export function useLiveNowMs(active: boolean) {
  const [, setTick] = React.useState(0)
  React.useEffect(() => {
    if (!active) return
    return subscribeLiveTick(() => setTick((value) => value + 1))
  }, [active])
  return active ? Date.now() : 0
}
