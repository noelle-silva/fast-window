import { describe, expect, it } from 'vitest'
import { createSessionScrollAnimator } from './sessionScrollAnimation'

// 只用到滚动几何，不需要真的 DOM 节点。
function makeHost(init?: { scrollTop?: number; clientHeight?: number; scrollHeight?: number }) {
  return {
    scrollTop: init?.scrollTop ?? 0,
    clientHeight: init?.clientHeight ?? 800,
    scrollHeight: init?.scrollHeight ?? 4000,
  } as unknown as HTMLElement
}

// 把帧调度攥在手里：手动推进时间，才能稳定断言「动画走到哪了」。
function createHarness() {
  let queue: Array<(stamp: number) => void> = []
  let stamp = 0
  const animator = createSessionScrollAnimator({
    requestFrame: (callback) => {
      queue.push(callback)
      return queue.length
    },
    cancelFrame: () => {
      queue = []
    },
    now: () => stamp,
  })
  const frame = (ms = 16.7) => {
    stamp += ms
    const pending = queue
    queue = []
    for (const callback of pending) callback(stamp)
  }
  const run = (count: number, ms = 16.7) => {
    for (let i = 0; i < count; i += 1) frame(ms)
  }
  return { animator, frame, run }
}

describe('会话滚动推进器', () => {
  it('一路推到目标后自己停下', () => {
    const host = makeHost({ scrollTop: 0 })
    const { animator, run } = createHarness()

    animator.moveTo(host, 700)
    expect(animator.target()).toBe(700)

    run(300)
    expect(host.scrollTop).toBe(700)
    expect(animator.target()).toBe(null)
  })

  it('起步缓慢提速，不会一上来就冲到峰值', () => {
    const host = makeHost({ scrollTop: 0 })
    const { animator, frame } = createHarness()

    animator.moveTo(host, 700)
    frame()
    const firstStep = host.scrollTop
    frame()
    const secondStep = host.scrollTop - firstStep
    frame()
    const thirdStep = host.scrollTop - firstStep - secondStep

    // 速度逐帧增加，而且是温和增加：第二帧不会比第一帧猛好几倍。
    expect(secondStep).toBeGreaterThan(0)
    expect(secondStep).toBeLessThan(firstStep * 4)
    expect(thirdStep).toBeGreaterThan(secondStep)
  })

  it('目标突然拉远时，速度是慢慢提起来的，不会突然给一脚', () => {
    const host = makeHost({ scrollTop: 0 })
    const { animator, frame } = createHarness()

    animator.moveTo(host, 700)
    for (let i = 0; i < 8; i += 1) frame()
    const beforeJump = host.scrollTop
    frame()
    const steadyStep = host.scrollTop - beforeJump
    expect(steadyStep).toBeGreaterThan(0)

    // 目标一下拉远到三倍，模拟快速连按。
    animator.moveTo(host, 2100)
    const atJump = host.scrollTop
    frame()
    const afterJumpStep = host.scrollTop - atJump

    expect(afterJumpStep).toBeLessThan(steadyStep * 2.5)
    expect(afterJumpStep - steadyStep).toBeLessThan(12)
  })

  it('连按时目标继续累加，位置一路向前不回头', () => {
    const host = makeHost({ scrollTop: 0 })
    const { animator, frame, run } = createHarness()

    animator.moveTo(host, 700)
    frame()
    frame()
    frame()
    const midway = host.scrollTop
    expect(midway).toBeGreaterThan(0)
    expect(midway).toBeLessThan(700)

    // 第二下从「上一次的目标」起算，而不是从正在滚动中的当前位置。
    const base = animator.target()
    expect(base).toBe(700)
    animator.moveTo(host, 1400)

    const samples: number[] = []
    for (let i = 0; i < 60; i += 1) {
      frame()
      samples.push(host.scrollTop)
    }
    for (let i = 1; i < samples.length; i += 1) {
      expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1] - 0.001)
    }

    run(300)
    expect(host.scrollTop).toBe(1400)
    expect(animator.target()).toBe(null)
  })

  it('目标被夹在可滚范围内', () => {
    const host = makeHost({ scrollTop: 0 })
    const { animator, run } = createHarness()

    animator.moveTo(host, 99999)
    run(400)
    expect(host.scrollTop).toBe(3200)

    animator.moveTo(host, -500)
    run(400)
    expect(host.scrollTop).toBe(0)
  })

  it('位置被外部改动时让位，不再往回抢', () => {
    const host = makeHost({ scrollTop: 0 })
    const { animator, frame } = createHarness()

    animator.moveTo(host, 700)
    frame()
    frame()

    // 模拟滚轮 / 拖滑块：位置被别的力量推着走。
    host.scrollTop += 300
    frame()

    expect(animator.target()).toBe(null)
    const settled = host.scrollTop
    frame()
    frame()
    expect(host.scrollTop).toBe(settled)
  })

  it('cancel 之后不再推进', () => {
    const host = makeHost({ scrollTop: 0 })
    const { animator, frame } = createHarness()

    animator.moveTo(host, 700)
    frame()
    const before = host.scrollTop
    expect(before).toBeGreaterThan(0)

    animator.cancel()
    expect(animator.target()).toBe(null)

    frame()
    frame()
    expect(host.scrollTop).toBe(before)
  })

  it('换容器时以新容器的位置重新起算', () => {
    const first = makeHost({ scrollTop: 0 })
    const second = makeHost({ scrollTop: 1000 })
    const { animator, run } = createHarness()

    animator.moveTo(first, 700)
    run(2)
    animator.moveTo(second, 1700)
    run(400)

    expect(second.scrollTop).toBe(1700)
    expect(first.scrollTop).toBeLessThan(700)
  })
})
