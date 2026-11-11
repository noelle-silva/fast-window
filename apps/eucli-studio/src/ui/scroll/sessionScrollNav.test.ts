import { describe, expect, it } from 'vitest'
import {
  canSessionScroll,
  resolveSessionScrollIntent,
  resolveSessionScrollTop,
} from './sessionScrollNav'

// 测试用比例：取原生手感（87.5%）作为基准，另有一组用 80% 验证可调。
const STEP = 0.875

function keyEvent(init: Record<string, any>) {
  return { key: '', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...init }
}

function scrollBox(init?: { scrollTop?: number; clientHeight?: number; scrollHeight?: number }) {
  return {
    scrollTop: init?.scrollTop ?? 0,
    clientHeight: init?.clientHeight ?? 800,
    scrollHeight: init?.scrollHeight ?? 4000,
  }
}

describe('Ctrl + 翻页键的意图翻译', () => {
  it('四个键各自对应一种滚动意图', () => {
    expect(resolveSessionScrollIntent(keyEvent({ key: 'PageUp', ctrlKey: true }))).toBe('page-up')
    expect(resolveSessionScrollIntent(keyEvent({ key: 'PageDown', ctrlKey: true }))).toBe('page-down')
    expect(resolveSessionScrollIntent(keyEvent({ key: 'Home', ctrlKey: true }))).toBe('top')
    expect(resolveSessionScrollIntent(keyEvent({ key: 'End', ctrlKey: true }))).toBe('bottom')
  })

  it('没有 Ctrl 就不接', () => {
    expect(resolveSessionScrollIntent(keyEvent({ key: 'PageDown' }))).toBe('')
    expect(resolveSessionScrollIntent(keyEvent({ key: 'End' }))).toBe('')
  })

  it('带 Shift / Alt / Meta 的一律不接', () => {
    expect(resolveSessionScrollIntent(keyEvent({ key: 'End', ctrlKey: true, shiftKey: true }))).toBe('')
    expect(resolveSessionScrollIntent(keyEvent({ key: 'Home', ctrlKey: true, shiftKey: true }))).toBe('')
    expect(resolveSessionScrollIntent(keyEvent({ key: 'PageDown', ctrlKey: true, altKey: true }))).toBe('')
    expect(resolveSessionScrollIntent(keyEvent({ key: 'PageDown', ctrlKey: true, metaKey: true }))).toBe('')
  })

  it('跟滚动无关的键不受影响', () => {
    expect(resolveSessionScrollIntent(keyEvent({ key: 'a', ctrlKey: true }))).toBe('')
    expect(resolveSessionScrollIntent(keyEvent({ key: 'ArrowDown', ctrlKey: true }))).toBe('')
    expect(resolveSessionScrollIntent(keyEvent({ key: 'PageUp', ctrlKey: true, shiftKey: false }))).toBe('page-up')
  })

  it('拿不到事件就当没发生', () => {
    expect(resolveSessionScrollIntent(null)).toBe('')
    expect(resolveSessionScrollIntent(undefined)).toBe('')
  })
})

describe('容器够不够滚', () => {
  it('没有容器、或内容不满一屏时不接', () => {
    expect(canSessionScroll(null)).toBe(false)
    expect(canSessionScroll({ scrollHeight: 800, clientHeight: 800 })).toBe(false)
    expect(canSessionScroll({ scrollHeight: 801, clientHeight: 800 })).toBe(false)
  })

  it('内容真的超出一屏才接', () => {
    expect(canSessionScroll({ scrollHeight: 802, clientHeight: 800 })).toBe(true)
    expect(canSessionScroll({ scrollHeight: 4000, clientHeight: 800 })).toBe(true)
  })
})

describe('滚动意图的落点', () => {
  it('往下翻一屏：按传入的比例算，留出重叠', () => {
    expect(resolveSessionScrollTop(scrollBox({ scrollTop: 500 }), 'page-down', STEP)).toBe(500 + 800 * STEP)
  })

  it('往上翻一屏：顶到头就停在 0', () => {
    expect(resolveSessionScrollTop(scrollBox({ scrollTop: 300 }), 'page-up', STEP)).toBe(0)
    expect(resolveSessionScrollTop(scrollBox({ scrollTop: 2000 }), 'page-up', STEP)).toBe(2000 - 800 * STEP)
  })

  it('往下翻一屏：底到头就停在最大值', () => {
    expect(resolveSessionScrollTop(scrollBox({ scrollTop: 3000 }), 'page-down', STEP)).toBe(3200)
  })

  it('首尾两端各就各位', () => {
    expect(resolveSessionScrollTop(scrollBox({ scrollTop: 1200 }), 'top', STEP)).toBe(0)
    expect(resolveSessionScrollTop(scrollBox({ scrollTop: 1200 }), 'bottom', STEP)).toBe(3200)
  })

  it('内容不满一屏时，任何意图都落在 0，不会写出负数或越界值', () => {
    const narrow = () => scrollBox({ scrollTop: 0, scrollHeight: 600 })
    expect(resolveSessionScrollTop(narrow(), 'page-down', STEP)).toBe(0)
    expect(resolveSessionScrollTop(narrow(), 'bottom', STEP)).toBe(0)
    expect(resolveSessionScrollTop(narrow(), 'page-up', STEP)).toBe(0)
  })

  it('起点由调用方给：连按时用上一次的目标继续累加', () => {
    // 动画跑到一半，实际位置只有 400，但目标已经是 700；第二下应该从 700 继续。
    expect(resolveSessionScrollTop(scrollBox({ scrollTop: 700 }), 'page-down', STEP)).toBe(700 + 800 * STEP)
  })
})

describe('步长可调', () => {
  it('比例越小，一屏翻得越少', () => {
    const el = scrollBox({ scrollTop: 1000 })
    expect(resolveSessionScrollTop(el, 'page-down', 0.8)).toBe(1640)
    expect(resolveSessionScrollTop(el, 'page-down', 0.6)).toBe(1480)
  })

  it('首尾两端不受步长影响', () => {
    const el = scrollBox({ scrollTop: 1200 })
    expect(resolveSessionScrollTop(el, 'top', 0.5)).toBe(0)
    expect(resolveSessionScrollTop(el, 'bottom', 1)).toBe(3200)
  })
})
