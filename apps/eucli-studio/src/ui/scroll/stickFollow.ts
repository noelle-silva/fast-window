// 贴底跟随的判定内核（纯逻辑，不碰 DOM 生命周期）。
//
// 判定不靠「此刻离底多远」单独下结论 —— 程序性贴底写进去之后内容往往还在长，
// 浏览器派发这次滚动的 scroll 事件时量到的距离已经变大，把它当成用户上滚
// 会让跟随莫名其妙断掉。这里同时看 scrollTop 的位移方向：内容增长不会让
// scrollTop 变小，只有用户往上看才会。

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

export function readGeometry(el: HTMLElement): ScrollGeometry {
  return { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }
}

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
