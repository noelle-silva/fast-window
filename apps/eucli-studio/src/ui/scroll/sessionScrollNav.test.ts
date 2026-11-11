import { describe, expect, it } from 'vitest'
import {
  SESSION_SCROLL_PAGE_STEP_RATIO,
  applySessionScrollIntent,
  canSessionScroll,
  resolveSessionScrollIntent,
  resolveSessionScrollTop,
} from './sessionScrollNav'

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

function scrollSurface(init?: { scrollTop?: number; clientHeight?: number; scrollHeight?: number }) {
  const calls: Array<{ top: number; behavior?: ScrollBehavior }> = []
  return {
    scrollTop: init?.scrollTop ?? 0,
    clientHeight: init?.clientHeight ?? 800,
    scrollHeight: init?.scrollHeight ?? 4000,
    calls,
    scrollTo(options: { top: number; behavior?: ScrollBehavior }) {
      calls.push(options)
    },
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
  it('往下翻一屏：按可视高度打八七五折，留出重叠', () => {
    expect(resolveSessionScrollTop(scrollBox({ scrollTop: 500 }), 'page-down')).toBe(
      500 + 800 * SESSION_SCROLL_PAGE_STEP_RATIO,
    )
  })

  it('往上翻一屏：顶到头就停在 0', () => {
    expect(resolveSessionScrollTop(scrollBox({ scrollTop: 300 }), 'page-up')).toBe(0)
    expect(resolveSessionScrollTop(scrollBox({ scrollTop: 2000 }), 'page-up')).toBe(
      2000 - 800 * SESSION_SCROLL_PAGE_STEP_RATIO,
    )
  })

  it('往下翻一屏：底到头就停在最大值', () => {
    expect(resolveSessionScrollTop(scrollBox({ scrollTop: 3000 }), 'page-down')).toBe(3200)
  })

  it('首尾两端各就各位', () => {
    expect(resolveSessionScrollTop(scrollBox({ scrollTop: 1200 }), 'top')).toBe(0)
    expect(resolveSessionScrollTop(scrollBox({ scrollTop: 1200 }), 'bottom')).toBe(3200)
  })

  it('内容不满一屏时，任何意图都落在 0，不会写出负数或越界值', () => {
    const narrow = () => scrollBox({ scrollTop: 0, scrollHeight: 600 })
    expect(resolveSessionScrollTop(narrow(), 'page-down')).toBe(0)
    expect(resolveSessionScrollTop(narrow(), 'bottom')).toBe(0)
    expect(resolveSessionScrollTop(narrow(), 'page-up')).toBe(0)
  })
})

describe('落点交给平滑滚动', () => {
  it('走平滑通道，目标位置与算出来的一致', () => {
    const el = scrollSurface({ scrollTop: 1000 })
    applySessionScrollIntent(el, 'page-down')
    expect(el.calls).toEqual([{ top: 1700, behavior: 'smooth' }])
  })

  it('四种意图都不直接写位置，一律经过滚动动画', () => {
    const el = scrollSurface({ scrollTop: 1200 })
    applySessionScrollIntent(el, 'top')
    applySessionScrollIntent(el, 'bottom')
    expect(el.calls).toEqual([
      { top: 0, behavior: 'smooth' },
      { top: 3200, behavior: 'smooth' },
    ])
    expect(el.scrollTop).toBe(1200)
  })
})
