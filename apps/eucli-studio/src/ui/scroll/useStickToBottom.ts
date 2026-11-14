import * as React from 'react'

// 自滚区域的跟底：内容还在增长时，只要视口还归我们管就继续贴住；
// 用户真的把视口往上带走才交还控制权，滚回底部再恢复跟随。
//
// 判定不靠「此刻离底多远」单独下结论 —— 程序性贴底写进去之后内容往往还在长，
// 浏览器派发这次滚动的 scroll 事件时量到的距离已经变大，把它当成用户上滚
// 会让跟随莫名其妙断掉。这里同时看 scrollTop 的位移方向：内容增长不会让
// scrollTop 变小，只有用户往上看才会。
//
// 除了维护「是否跟随」，这里还把状态与「立刻回到底部」的命令交出去：
// 界面据此在离底时显示回底按钮，点一下即恢复跟随。

/** 距离底部多少像素以内算贴底。 */
export const STICK_TO_BOTTOM_THRESHOLD_PX = 24

/** 判定只看这三个几何量。 */
export type ScrollGeometry = {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}

export type StickFollowDecision = {
  /** 下一步是否继续跟随底部。 */
  following: boolean
  /** 跟随中但视口已经被顶离底部：立刻补回底部。 */
  repin: boolean
}

// 几何量都是整数，1px 容差用来吸收取整与子像素带来的抖动。
const GEOMETRY_EPSILON = 1

/**
 * 一次滚动之后，视口还该不该继续跟随底部。
 *
 * 三种位移要分开看：
 * - 内容在下方长高：scrollTop 不动、离底距离变大 —— 跟随照旧，并当场补位；
 * - 内容收缩把 scrollTop 夹小：回落量能被内容缩短解释 —— 不算用户上滚；
 * - 用户往上滚：scrollTop 真的变小且超出阈值 —— 交还控制权。
 */
export function decideStickFollow(input: {
  following: boolean
  prev: ScrollGeometry
  next: ScrollGeometry
  threshold?: number
}): StickFollowDecision {
  const { following, prev, next, threshold = STICK_TO_BOTTOM_THRESHOLD_PX } = input
  const distance = next.scrollHeight - next.scrollTop - next.clientHeight

  // 已经到底（含阈值内的擦边）：无论之前有没有让位，都回到跟随。
  if (distance <= threshold) return { following: true, repin: false }

  const topDrop = prev.scrollTop - next.scrollTop
  const heightShrink = prev.scrollHeight - next.scrollHeight
  const movedUpByUser = topDrop > GEOMETRY_EPSILON && heightShrink < topDrop - GEOMETRY_EPSILON

  // 用户已经让位：内容再长也不把人拽回来。
  if (!following) return { following: false, repin: false }
  // 用户把视口往上带离了底部：交还控制权。
  if (movedUpByUser) return { following: false, repin: false }
  // 视口还归我们管，只是内容长高把它顶开了：下一帧补回底部。
  return { following: true, repin: true }
}

function readGeometry(el: HTMLElement): ScrollGeometry {
  return { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }
}

export function useStickToBottom(options: {
  scrollRef: React.RefObject<HTMLElement | null>
  contentRef?: React.RefObject<HTMLElement | null>
  enabled: boolean
}) {
  const { scrollRef, contentRef, enabled } = options
  // 与 following 同源：ref 供事件里即时判断，state 供界面按需重绘（只在跨过阈值时变）。
  const followingRef = React.useRef(true)
  // 上一次认定过的几何：判定「scrollTop 有没有被用户往上带走」的基准。
  const geometryRef = React.useRef<ScrollGeometry | null>(null)
  const frameRef = React.useRef(0)
  const [following, setFollowing] = React.useState(true)

  // 贴到底并记下这一笔写入后的几何，让随后派发的那次滚动事件认出「这是我们自己写的」。
  const pinToBottom = React.useCallback((el: HTMLElement) => {
    el.scrollTop = el.scrollHeight
    geometryRef.current = readGeometry(el)
  }, [])

  const applyFollowing = React.useCallback((next: boolean) => {
    if (followingRef.current === next) return
    followingRef.current = next
    setFollowing(next)
  }, [])

  // 回到底部并恢复跟随：内容还在持续增长时，后续增量会由贴底逻辑继续接住。
  const scrollToBottom = React.useCallback(() => {
    followingRef.current = true
    setFollowing(true)
    const el = scrollRef.current
    if (el) pinToBottom(el)
  }, [scrollRef, pinToBottom])

  React.useEffect(() => {
    const el = scrollRef.current
    if (!enabled || !el) return

    // 首次挂载默认贴底：直接把视口送到最新，再开始按真实滚动事件判定。
    // （这一步不能省：内容一挂上就超过一屏时，首次判定会把默认贴底推翻。）
    followingRef.current = true
    setFollowing(true)
    pinToBottom(el)

    // 一帧最多写一次；同一帧里的多次增量只保留最后一次调度。
    const pin = () => {
      if (!followingRef.current || frameRef.current) return
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = 0
        const node = scrollRef.current
        if (!node || !followingRef.current) return
        pinToBottom(node)
      })
    }

    // 只认真实滚动事件：内容自然增高不算用户上滚（判定见 decideStickFollow）。
    const onScroll = () => {
      const prev = geometryRef.current ?? readGeometry(el)
      const next = readGeometry(el)
      const decision = decideStickFollow({ following: followingRef.current, prev, next })
      geometryRef.current = next
      applyFollowing(decision.following)
      // 视觉上已经离底，但跟随权还在：当场补回去，不用等下一次尺寸变化。
      if (decision.repin) pin()
    }
    el.addEventListener('scroll', onScroll, { passive: true })

    // 内容变化来自 ResizeObserver 而不是文本变化：工具块展开、Markdown 渲染完成、
    // 图片与图表落地都会改高度，看文本会漏。
    const observer = new ResizeObserver(pin)
    observer.observe(el)
    const content = contentRef?.current
    if (content) observer.observe(content)

    return () => {
      el.removeEventListener('scroll', onScroll)
      observer.disconnect()
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current)
        frameRef.current = 0
      }
    }
  }, [enabled, scrollRef, contentRef, applyFollowing, pinToBottom])

  return { following, scrollToBottom }
}
