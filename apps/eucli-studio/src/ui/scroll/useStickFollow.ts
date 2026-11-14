import * as React from 'react'
import { decideStickFollow, readGeometry, type ScrollGeometry } from './stickFollow'

// 跟底内核：维护「视口还归不归我们管」，并提供一次贴底写入的调度。
// 谁在什么时机调度写入由使用方决定 —— 内滚动靠 ResizeObserver、消息区靠渲染依赖、
// 思考面板靠文本变化。这里只负责三件事：
//   1. 用真实滚动事件判定跟随权（判定规则见 stickFollow）；
//   2. 一帧最多写一次 scrollTop，写完记下基准；
//   3. 跟随中量到被内容顶开时当场补位。

export type StickFollow = {
  /** 是否还在跟随底部。跨过阈值才变，供界面按需重绘。 */
  following: boolean
  /** 同源 ref：事件与调度里即时判断用。 */
  followingRef: React.MutableRefObject<boolean>
  setFollowing: (next: boolean) => void
  /** 排一帧吸附（一帧最多一次）；只看排队那一刻的跟随状态与启停。 */
  schedulePin: () => void
  /** 撤掉尚未执行的那一帧（用户自己要换视野时用）。 */
  cancelPin: () => void
  /** 立刻贴到底并恢复跟随。 */
  scrollToBottom: () => void
}

export function useStickFollow(options: {
  scrollRef: React.RefObject<HTMLElement | null>
  enabled: boolean
  // 滚动节点换人时（切会话、折叠区重建）用它重挂监听；值只要在换节点时变即可。
  viewportKey?: unknown
}): StickFollow {
  const { scrollRef, enabled, viewportKey } = options
  const followingRef = React.useRef(true)
  // 上一次认定过的几何：判定「scrollTop 有没有被用户往上带走」的基准。
  const geometryRef = React.useRef<ScrollGeometry | null>(null)
  // 我们自己最后一次贴底写入后的 scrollTop；内容增长不会移动它，别人动过就对不上。
  const pinnedTopRef = React.useRef<number | null>(null)
  const frameRef = React.useRef(0)
  const enabledRef = React.useRef(enabled)
  enabledRef.current = enabled
  const [following, setFollowingState] = React.useState(true)

  // 贴到底并记下这一笔写入后的几何，让随后派发的那次滚动事件认出「这是我们自己写的」。
  const pinToBottom = React.useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    const settled = readGeometry(el)
    geometryRef.current = settled
    pinnedTopRef.current = settled.scrollTop
  }, [scrollRef])

  const setFollowing = React.useCallback((next: boolean) => {
    if (followingRef.current === next) return
    followingRef.current = next
    setFollowingState(next)
  }, [])

  const cancelPin = React.useCallback(() => {
    if (!frameRef.current) return
    cancelAnimationFrame(frameRef.current)
    frameRef.current = 0
  }, [])

  const schedulePin = React.useCallback(() => {
    if (!enabledRef.current || !followingRef.current || frameRef.current) return
    const el = scrollRef.current
    if (!el) return
    // 排队那一刻视口停在哪：执行前若被滚轮或平滑推进器动过，这一帧就整帧让出去。
    // 内容增长不会移动 scrollTop，所以正常的贴底写入不受影响。
    const topAtSchedule = el.scrollTop
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0
      if (!enabledRef.current || !followingRef.current) return
      const node = scrollRef.current
      if (!node) return
      // 排队期间用户滚了一下：哪怕滚动事件还没派发，也绝不把这一下吞掉。
      if (Math.abs(node.scrollTop - topAtSchedule) > 1) return
      pinToBottom()
    })
  }, [pinToBottom])

  const scrollToBottom = React.useCallback(() => {
    if (!enabledRef.current) return
    followingRef.current = true
    setFollowingState(true)
    pinToBottom()
  }, [pinToBottom])

  React.useEffect(() => {
    const el = scrollRef.current
    if (!enabled || !el) return

    // 换节点时用新节点的几何当基准：旧节点的数字对不上，会把第一下误判成上滚。
    geometryRef.current = readGeometry(el)

    const onScroll = () => {
      const prev = geometryRef.current ?? readGeometry(el)
      const next = readGeometry(el)
      const decision = decideStickFollow({ following: followingRef.current, prev, next })
      geometryRef.current = next
      setFollowing(decision.following)
      // 视觉上已经离底，但跟随权还在：当场补回去，不用等下一次尺寸变化。
      // 只在「视口仍停在我们贴的那一格」时才补 —— 别人的平滑推进或用户自己拖过，
      // scrollTop 就对不上了，那时该由调用方的调度通道接手，别在这里抢方向盘。
      const untouched = pinnedTopRef.current !== null && Math.abs(next.scrollTop - pinnedTopRef.current) <= 1
      if (decision.repin && untouched) schedulePin()
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [enabled, scrollRef, viewportKey, setFollowing, schedulePin])

  React.useEffect(() => cancelPin, [cancelPin])

  return { following, followingRef, setFollowing, schedulePin, cancelPin, scrollToBottom }
}
