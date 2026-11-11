// 会话消息区的滚动推进器。
// 只做一件事：把一个滚动容器平滑推向目标位置，并且允许「目标边跑边改」。
//
// 两条关键取舍：
//   1. 不用浏览器自带的平滑滚动：它每调用一次就重新起一段动画，连按等于反复刹车再起步。
//   2. 不用「每帧朝目标追一定比例」：那种写法速度会突变，起步猛、随即衰减，看着一蹦一蹦。
// 这里用临界阻尼跟随：速度是连续的，目标突然变远也只是慢慢提速，不会突然给一脚。
// 代价是收敛渐近，靠一个小于一像素的吸附收尾。

// 跟随时间常数：越大越绵软。0.22 秒大约 0.3 秒走完一屏，是原生翻页的柔和版。
const SMOOTH_TIME_S = 0.22
// 差不到一像素就吸附到位，避免渐近的尾巴拖很久。
const SETTLE_PX = 0.8
// 速度低于这个值才算真的停稳（px/秒），防止高速掠过时被误吸附。
const SETTLE_SPEED = 30
// 位置被别人改动超过这个量（滚轮、拖滑块、跟底写入）就认为用户接管了，动画让位。
const EXTERNAL_DRIFT_PX = 2
// 速度上限按「每秒几屏」给：普通翻页碰不到，只兜住 Ctrl+End 这种长距离和极端连按。
const MAX_SPEED_SCREENS_PER_SECOND = 8

export type SessionScrollAnimator = {
  /** 推向目标位置；正在跑的时候再调用只改目标，不重启动画。 */
  moveTo: (el: HTMLElement, top: number) => void
  /** 当前正在逼近的目标；没有动画时为 null。连按翻页时用它作为累加基准。 */
  target: () => number | null
  cancel: () => void
}

export function createSessionScrollAnimator(deps?: {
  requestFrame?: (callback: (stamp: number) => void) => number
  cancelFrame?: (handle: number) => void
  now?: () => number
}): SessionScrollAnimator {
  const requestFrame = deps?.requestFrame ?? ((callback: (stamp: number) => void) => requestAnimationFrame(callback))
  const cancelFrame = deps?.cancelFrame ?? ((handle: number) => cancelAnimationFrame(handle))
  const now = deps?.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()))

  let handle = 0
  let node: HTMLElement | null = null
  let goal = 0
  // 上一帧我们自己写进去的位置：用来分辨「是我们在滚」还是「别人在滚」。
  let written = 0
  let lastTick = 0
  let velocity = 0
  let running = false

  function stop() {
    if (handle) cancelFrame(handle)
    handle = 0
    running = false
    node = null
    lastTick = 0
    velocity = 0
  }

  // 临界阻尼跟随（SmoothDamp）：给定当前位置、目标与当前速度，算出这一帧该到哪。
  // 速度作为状态被一路带着走，所以目标变化时速度只做平滑过渡，不会突变。
  function advance(current: number, target: number, dt: number, maxSpeed: number): number {
    const smoothTime = Math.max(0.0001, SMOOTH_TIME_S)
    const omega = 2 / smoothTime
    const x = omega * dt
    const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x)

    const originalTo = target
    let change = current - target
    const maxChange = maxSpeed * smoothTime
    change = Math.max(-maxChange, Math.min(maxChange, change))

    const anchored = current - change
    const temp = (velocity + omega * change) * dt
    velocity = (velocity - omega * temp) * decay
    let output = anchored + (change + temp) * decay

    // 别冲过头：越界就停在目标上，速度同步归零。
    if (originalTo - current > 0 === output > originalTo) {
      output = originalTo
      velocity = (output - originalTo) / dt
    }
    return output
  }

  function tick() {
    handle = 0
    if (!running || !node) return

    const current = node.scrollTop
    if (Math.abs(current - written) > EXTERNAL_DRIFT_PX) {
      stop()
      return
    }

    const gap = goal - current
    if (Math.abs(gap) <= SETTLE_PX && Math.abs(velocity) <= SETTLE_SPEED) {
      node.scrollTop = goal
      stop()
      return
    }

    // 按真实帧间隔推进：高刷屏不会变快，掉帧也不会一跳到底。
    const stamp = now()
    const dtMs = lastTick ? Math.min(64, Math.max(1, stamp - lastTick)) : 1000 / 60
    lastTick = stamp

    const maxSpeed = node.clientHeight * MAX_SPEED_SCREENS_PER_SECOND
    node.scrollTop = advance(current, goal, dtMs / 1000, maxSpeed)
    written = node.scrollTop
    handle = requestFrame(tick)
  }

  return {
    moveTo(el, top) {
      const maxTop = Math.max(0, el.scrollHeight - el.clientHeight)
      if (node !== el) {
        node = el
        written = el.scrollTop
        lastTick = 0
        velocity = 0
      }
      goal = Math.min(maxTop, Math.max(0, top))
      running = true
      if (handle) return
      handle = requestFrame(tick)
    },
    target() {
      return running ? goal : null
    },
    cancel() {
      stop()
    },
  }
}
