import * as React from 'react'
import { normalizeScrollTops } from './workspaceModel'

// 侧边栏列表的滚动记忆统一机制：面板负责「上报当前滚动位置 / 按记忆还原」，
// 现场负责「按标识记账 / 防抖落盘 / 切换与可见化还原 / 失效清理」。
// 左右两侧边栏共用同一套语义，避免各写一份同构实现。

/** 面板层：绑定滚动容器，rAF 节流上报；restoreKey 或 restoreSignal 变化时按最新记忆值还原。 */
export function useScrollMemory(opts: {
  scrollTop: number
  /** 记忆所属标识（工作区/收藏夹）：变化即触发还原。 */
  restoreKey: string
  /** 现场可见化等外部还原信号：变化即重新应用记忆。 */
  restoreSignal: number
  onScrollTopChange?: (scrollTop: number) => void
}): { scrollRef: React.MutableRefObject<HTMLDivElement | null>; onScroll: () => void } {
  const { scrollTop, restoreKey, restoreSignal, onScrollTopChange } = opts
  const scrollRef = React.useRef<HTMLDivElement | null>(null)

  // 滚动上报：rAF 节流，避免滚动期间高频回调。
  const reportRafRef = React.useRef<number | null>(null)
  const onScroll = React.useCallback(() => {
    if (!onScrollTopChange) return
    if (reportRafRef.current != null) return
    reportRafRef.current = requestAnimationFrame(() => {
      reportRafRef.current = null
      const el = scrollRef.current
      if (!el) return
      onScrollTopChange(el.scrollTop)
    })
  }, [onScrollTopChange])
  React.useEffect(() => {
    return () => {
      if (reportRafRef.current != null) cancelAnimationFrame(reportRafRef.current)
      reportRafRef.current = null
    }
  }, [])

  // 还原：目标值经「最新值」ref 读取，同标识内的滚动上报与普通重渲染不触发还原，不与用户操作抢位置。
  const valueRef = React.useRef(scrollTop)
  React.useLayoutEffect(() => {
    valueRef.current = scrollTop
  })
  React.useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const target = Math.max(0, Math.floor(Number(valueRef.current) || 0))
    if (el.scrollTop !== target) el.scrollTop = target
  }, [restoreKey, restoreSignal])

  return { scrollRef, onScroll }
}

export type KeyedScrollMemory = {
  /** 记账容器：现场写盘时直接读取（与现场状态合并持久化）。 */
  topsRef: React.MutableRefObject<Record<string, number>>
  /** 现场可见化还原信号：传给面板触发重新应用。 */
  restoreSignal: number
  report: (key: string, scrollTop: number) => void
  flush: () => void
  reset: (value: unknown) => void
  clear: (key: string) => void
}

/** 现场层：按标识记账，防抖落盘，切走/卸载前冲刷，可见化时触发还原。 */
export function useKeyedScrollMemory(opts: {
  /** 记账容器由调用方持有，便于写盘时与现场状态合并。 */
  topsRef: React.MutableRefObject<Record<string, number>>
  /** 现场是否可见：由不可见转可见时触发一次还原；切走时冲刷未落盘记忆。 */
  visible: boolean
  debounceMs: number
  /** 落盘回调：把最新记账写入仓库状态。 */
  onPersist: () => void
}): KeyedScrollMemory {
  const { topsRef, visible, debounceMs, onPersist } = opts
  const dirtyRef = React.useRef(false)
  const saveTimerRef = React.useRef<number | null>(null)
  const [restoreSignal, setRestoreSignal] = React.useState(0)

  // 落盘回调经 ref 转发，避免其身份变化重置防抖与还原逻辑。
  const onPersistRef = React.useRef(onPersist)
  React.useEffect(() => {
    onPersistRef.current = onPersist
  }, [onPersist])

  const persistNow = React.useCallback(() => {
    if (!dirtyRef.current) return
    dirtyRef.current = false
    onPersistRef.current()
  }, [])

  const flush = React.useCallback(() => {
    if (saveTimerRef.current != null) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    persistNow()
  }, [persistNow])

  const report = React.useCallback(
    (key: string, scrollTop: number) => {
      const id = String(key || '').trim()
      if (!id) return
      const n = Math.floor(Number(scrollTop))
      const value = Number.isFinite(n) && n > 0 ? n : 0
      if (topsRef.current[id] === value) return
      topsRef.current[id] = value
      dirtyRef.current = true
      if (saveTimerRef.current != null) return
      saveTimerRef.current = window.setTimeout(() => {
        saveTimerRef.current = null
        persistNow()
      }, debounceMs)
    },
    [debounceMs, persistNow, topsRef],
  )

  const reset = React.useCallback(
    (value: unknown) => {
      topsRef.current = normalizeScrollTops(value)
      dirtyRef.current = false
    },
    [topsRef],
  )

  const clear = React.useCallback(
    (key: string) => {
      const id = String(key || '').trim()
      if (!id || topsRef.current[id] == null) return
      delete topsRef.current[id]
      dirtyRef.current = true
    },
    [topsRef],
  )

  // 现场切走或卸载（回收）前，把尚未落盘的滚动位置写入仓库状态。
  React.useEffect(() => {
    if (visible) return
    flush()
  }, [flush, visible])
  React.useEffect(() => {
    return () => {
      flush()
    }
  }, [flush])

  // 现场每次可见化都触发还原（覆盖常驻期间可能的视图丢失）。
  React.useEffect(() => {
    if (!visible) return
    setRestoreSignal(signal => signal + 1)
  }, [visible])

  return { topsRef, restoreSignal, report, flush, reset, clear }
}
