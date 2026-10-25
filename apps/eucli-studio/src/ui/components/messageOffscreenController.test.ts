// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  estimateMessageHeight,
  messageHeightMemory,
  messageLayoutKey,
  messageOffscreenContentKey,
} from '../../domain/messageOffscreen'
import { MessageOffscreenController, type MessageOffscreenSlotMeta } from './messageOffscreenController'

type RectState = { top: number; height: number; width?: number }

function rect(state: RectState) {
  const width = state.width ?? 800
  return {
    x: 0,
    y: state.top,
    top: state.top,
    bottom: state.top + state.height,
    left: 0,
    right: width,
    width,
    height: state.height,
    toJSON() {
      return this
    },
  } as DOMRect
}

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = []
  callback: IntersectionObserverCallback
  options: IntersectionObserverInit | undefined
  targets = new Set<Element>()

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback
    this.options = options
    FakeIntersectionObserver.instances.push(this)
  }

  observe(target: Element) {
    this.targets.add(target)
  }

  unobserve(target: Element) {
    this.targets.delete(target)
  }

  disconnect() {
    this.targets.clear()
  }

  takeRecords() {
    return []
  }

  emit(entries: Array<{ target: Element; isIntersecting: boolean }>) {
    this.callback(entries as any, this as any)
  }
}

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = []
  callback: ResizeObserverCallback
  targets = new Set<Element>()

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    FakeResizeObserver.instances.push(this)
  }

  observe(target: Element) {
    this.targets.add(target)
  }

  unobserve(target: Element) {
    this.targets.delete(target)
  }

  disconnect() {
    this.targets.clear()
  }

  emit(entries: Array<{ target: Element }>) {
    this.callback(entries as any, this as any)
  }
}

function makeScroll() {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const state = { width: 800, height: 600, scrollHeight: 5000, scrollTop: 0 }
  Object.defineProperty(el, 'clientWidth', { configurable: true, get: () => state.width })
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => state.height })
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => state.scrollHeight })
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => state.scrollTop,
    set: (value: number) => {
      state.scrollTop = Number(value) || 0
    },
  })
  el.getBoundingClientRect = () => rect({ top: 0, height: state.height, width: state.width })
  return { el, state }
}

function makeSlot(scroll: HTMLElement, mid: string, state: RectState) {
  const el = document.createElement('div')
  el.setAttribute('data-fw-message-slot', mid)
  el.getBoundingClientRect = () => rect(state)
  scroll.appendChild(el)
  return { el, state }
}

// 让占位矩形跟随实际占位高度变化，用于验证跨越视口顶边时的补偿。
function makePlaceholderSlot(scroll: HTMLElement, mid: string, state: { top: number; height: number }) {
  const el = document.createElement('div')
  el.setAttribute('data-fw-message-slot', mid)
  el.getBoundingClientRect = () => {
    const hidden = el.style.getPropertyValue('content-visibility') === 'hidden'
    const intrinsic = Number.parseFloat(el.style.getPropertyValue('contain-intrinsic-size')) || 0
    return rect({ top: state.top, height: hidden && intrinsic > 0 ? intrinsic : state.height })
  }
  scroll.appendChild(el)
  return { el, state }
}

function message(id: string, content = '正文') {
  return { id, role: 'assistant', type: 'assistant', content, updatedAt: 1 }
}

function meta(value: any, contentKey = messageOffscreenContentKey(value), pinned = false): MessageOffscreenSlotMeta {
  return { pinned, contentKey, message: value }
}

function latestIntersectionObserver() {
  const instance = FakeIntersectionObserver.instances[FakeIntersectionObserver.instances.length - 1]
  if (!instance) throw new Error('intersection observer was not created')
  return instance
}

function latestResizeObserver() {
  const instance = FakeResizeObserver.instances[FakeResizeObserver.instances.length - 1]
  if (!instance) throw new Error('resize observer was not created')
  return instance
}

function offscreenState(el: HTMLElement) {
  return {
    visibility: el.style.getPropertyValue('content-visibility'),
    intrinsic: el.style.getPropertyValue('contain-intrinsic-size'),
    marker: el.getAttribute('data-fw-message-offscreen'),
  }
}

describe('message offscreen controller', () => {
  let scrollHost: ReturnType<typeof makeScroll>
  let controller: MessageOffscreenController

  beforeEach(() => {
    FakeIntersectionObserver.instances = []
    FakeResizeObserver.instances = []
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    messageHeightMemory.clear()
    scrollHost = makeScroll()
    controller = new MessageOffscreenController('layout-a')
    controller.setScrollElement(scrollHost.el)
  })

  afterEach(() => {
    controller.dispose()
    scrollHost.el.remove()
    vi.unstubAllGlobals()
  })

  it('retains the node, shows an estimated placeholder offscreen and restores measured layout near the viewport', () => {
    controller.setEnabled(true)
    const value = message('m-1')
    const slot = makeSlot(scrollHost.el, 'm-1', { top: 1800, height: 260 })

    controller.attach('m-1', slot.el, meta(value))
    expect(scrollHost.el.contains(slot.el)).toBe(true)
    expect(offscreenState(slot.el)).toEqual({
      visibility: 'hidden',
      intrinsic: `${estimateMessageHeight(value, 800)}px`,
      marker: 'hidden',
    })

    latestIntersectionObserver().emit([{ target: slot.el, isIntersecting: true }])
    expect(offscreenState(slot.el)).toEqual({ visibility: 'visible', intrinsic: '', marker: 'visible' })

    latestIntersectionObserver().emit([{ target: slot.el, isIntersecting: false }])
    expect(offscreenState(slot.el)).toEqual({ visibility: 'hidden', intrinsic: '260px', marker: 'hidden' })
    expect(scrollHost.el.contains(slot.el)).toBe(true)
  })

  it('keeps the latest measured height while rendered and refreshes it from resize observations', () => {
    controller.setEnabled(true)
    const value = message('m-1')
    const slot = makeSlot(scrollHost.el, 'm-1', { top: 1500, height: 300 })
    controller.attach('m-1', slot.el, meta(value))
    latestIntersectionObserver().emit([{ target: slot.el, isIntersecting: true }])

    slot.state.height = 450
    latestResizeObserver().emit([{ target: slot.el }])
    latestIntersectionObserver().emit([{ target: slot.el, isIntersecting: false }])

    expect(offscreenState(slot.el).intrinsic).toBe('450px')
  })

  it('compensates only placeholder changes above the visible viewport', () => {
    controller.setEnabled(true)
    scrollHost.state.scrollTop = 1000
    const aboveMessage = message('m-above', '短')
    const belowMessage = message('m-below', '短')
    const above = makeSlot(scrollHost.el, 'm-above', { top: -500, height: 300 })
    const below = makeSlot(scrollHost.el, 'm-below', { top: 2000, height: 400 })
    controller.attach('m-above', above.el, meta(aboveMessage))
    latestIntersectionObserver().emit([{ target: above.el, isIntersecting: true }])
    latestIntersectionObserver().emit([{ target: above.el, isIntersecting: false }])
    controller.attach('m-below', below.el, meta(belowMessage))

    const beforeAbove = scrollHost.state.scrollTop
    const longAbove = message('m-above', '长文本'.repeat(400))
    controller.update('m-above', meta(longAbove, messageOffscreenContentKey(longAbove, { userExpanded: true })))
    const expectedAbove = estimateMessageHeight(longAbove, 800)
    expect(scrollHost.state.scrollTop).toBe(beforeAbove + expectedAbove - 300)

    const beforeBelow = scrollHost.state.scrollTop
    const longBelow = message('m-below', '长文本'.repeat(400))
    controller.update('m-below', meta(longBelow, messageOffscreenContentKey(longBelow, { userExpanded: true })))
    expect(scrollHost.state.scrollTop).toBe(beforeBelow)
  })

  it('invalidates remembered heights when the layout condition changes', () => {
    controller.setEnabled(true)
    const value = message('m-1')
    const slot = makeSlot(scrollHost.el, 'm-1', { top: 1800, height: 300 })
    controller.attach('m-1', slot.el, meta(value))
    latestIntersectionObserver().emit([{ target: slot.el, isIntersecting: true }])
    latestIntersectionObserver().emit([{ target: slot.el, isIntersecting: false }])
    expect(offscreenState(slot.el).intrinsic).toBe('300px')

    controller.setLayoutSignature('layout-b')
    expect(offscreenState(slot.el).intrinsic).toBe(`${estimateMessageHeight(value, 800)}px`)

    latestIntersectionObserver().emit([{ target: slot.el, isIntersecting: true }])
    slot.state.height = 520
    controller.setLayoutSignature('layout-c')
    expect(
      messageHeightMemory.get(
        'm-1',
        messageLayoutKey('layout-c', 800),
        messageOffscreenContentKey(value),
      ),
    ).toBe(520)

    latestIntersectionObserver().emit([{ target: slot.el, isIntersecting: false }])
    expect(offscreenState(slot.el).intrinsic).toBe('520px')
  })

  it('invalidates remembered heights when the content condition changes', () => {
    controller.setEnabled(true)
    const value = message('m-1')
    const slot = makeSlot(scrollHost.el, 'm-1', { top: 1800, height: 300 })
    controller.attach('m-1', slot.el, meta(value))
    latestIntersectionObserver().emit([{ target: slot.el, isIntersecting: true }])
    latestIntersectionObserver().emit([{ target: slot.el, isIntersecting: false }])

    const edited = { ...value, content: '编辑后的长正文'.repeat(40), updatedAt: 2 }
    controller.update('m-1', meta(edited, messageOffscreenContentKey(edited, { editing: true, editingLength: 6 })))
    expect(offscreenState(slot.el).intrinsic).toBe(`${estimateMessageHeight(edited, 800)}px`)

    latestIntersectionObserver().emit([{ target: slot.el, isIntersecting: true }])
    slot.state.height = 640
    const nextContentKey = messageOffscreenContentKey(edited)
    controller.update('m-1', meta(edited, nextContentKey))
    expect(
      messageHeightMemory.get('m-1', messageLayoutKey('layout-a', 800), nextContentKey),
    ).toBe(640)
  })

  it('compensates when an above-viewport placeholder grows across the viewport top', () => {
    controller.setEnabled(true)
    scrollHost.state.scrollTop = 1000
    const short = message('m-cross', '短')
    const slot = makePlaceholderSlot(scrollHost.el, 'm-cross', { top: -200, height: 300 })
    controller.attach('m-cross', slot.el, meta(short))

    const before = scrollHost.state.scrollTop
    const oldEstimate = estimateMessageHeight(short, 800)
    expect(-200 + oldEstimate).toBeLessThanOrEqual(0)

    const long = message('m-cross', '长文本'.repeat(2000))
    controller.update('m-cross', meta(long, messageOffscreenContentKey(long, { userExpanded: true })))
    const newEstimate = estimateMessageHeight(long, 800)
    expect(-200 + newEstimate).toBeGreaterThan(0)
    expect(scrollHost.state.scrollTop).toBe(before + newEstimate - oldEstimate)
  })

  it('compensates when a hidden above-viewport message is restored and grows across the viewport top', () => {
    controller.setEnabled(true)
    scrollHost.state.scrollTop = 1000
    const value = message('m-grow', '短')
    const slot = makePlaceholderSlot(scrollHost.el, 'm-grow', { top: -200, height: 2000 })
    controller.attach('m-grow', slot.el, meta(value))
    const oldEstimate = estimateMessageHeight(value, 800)
    expect(-200 + oldEstimate).toBeLessThanOrEqual(0)
    expect(-200 + slot.state.height).toBeGreaterThan(0)

    const before = scrollHost.state.scrollTop
    latestIntersectionObserver().emit([{ target: slot.el, isIntersecting: true }])
    expect(scrollHost.state.scrollTop).toBe(before + slot.state.height - oldEstimate)
  })

  it('renders messages that became generating while the page was inactive', () => {
    const value = message('m-pin')
    const slot = makeSlot(scrollHost.el, 'm-pin', { top: 1800, height: 300 })
    controller.attach('m-pin', slot.el, meta(value))
    expect(offscreenState(slot.el).visibility).toBe('hidden')

    controller.update('m-pin', meta(value, messageOffscreenContentKey(value), true))
    expect(offscreenState(slot.el).visibility).toBe('hidden')

    controller.setEnabled(true)
    expect(offscreenState(slot.el).visibility).toBe('visible')
    latestIntersectionObserver().emit([{ target: slot.el, isIntersecting: false }])
    expect(offscreenState(slot.el).visibility).toBe('visible')
  })

  it('never hides a pinned generating message or its tail', () => {
    controller.setEnabled(true)
    const value = message('m-generating', '生成中')
    const slot = makeSlot(scrollHost.el, 'm-generating', { top: 2200, height: 300 })
    controller.attach('m-generating', slot.el, meta(value, messageOffscreenContentKey(value), true))
    expect(offscreenState(slot.el).visibility).toBe('visible')

    latestIntersectionObserver().emit([{ target: slot.el, isIntersecting: false }])
    expect(offscreenState(slot.el).visibility).toBe('visible')

    controller.update('m-generating', meta(value, messageOffscreenContentKey(value), false))
    expect(offscreenState(slot.el).visibility).toBe('hidden')

    latestIntersectionObserver().emit([{ target: slot.el, isIntersecting: true }])
    expect(offscreenState(slot.el).visibility).toBe('visible')
  })

  it('does not compute on a hidden keep-alive page and re-evaluates once when it becomes active', () => {
    const value = message('m-1')
    const slot = makeSlot(scrollHost.el, 'm-1', { top: 1600, height: 300 })
    controller.attach('m-1', slot.el, meta(value))
    expect(FakeIntersectionObserver.instances.length).toBe(0)
    expect(offscreenState(slot.el).visibility).toBe('hidden')

    controller.setEnabled(true)
    expect(FakeIntersectionObserver.instances.length).toBe(1)
    expect(latestIntersectionObserver().targets.has(slot.el)).toBe(true)
    latestIntersectionObserver().emit([{ target: slot.el, isIntersecting: true }])
    expect(offscreenState(slot.el).visibility).toBe('visible')

    const activeObserver = latestIntersectionObserver()
    controller.setEnabled(false)
    expect(activeObserver.targets.size).toBe(0)
    expect(offscreenState(slot.el).visibility).toBe('visible')
    activeObserver.emit([{ target: slot.el, isIntersecting: false }])
    expect(offscreenState(slot.el).visibility).toBe('visible')

    controller.setEnabled(true)
    expect(FakeIntersectionObserver.instances.length).toBe(2)
    expect(latestIntersectionObserver().targets.has(slot.el)).toBe(true)
    latestIntersectionObserver().emit([{ target: slot.el, isIntersecting: false }])
    expect(offscreenState(slot.el).visibility).toBe('hidden')
  })

  it('re-evaluates placeholder heights when the viewport width changes', () => {
    controller.setEnabled(true)
    const value = message('m-1', '宽度变化'.repeat(120))
    const slot = makeSlot(scrollHost.el, 'm-1', { top: 2500, height: 300 })
    controller.attach('m-1', slot.el, meta(value))
    const before = offscreenState(slot.el).intrinsic
    expect(before).toBe(`${estimateMessageHeight(value, 800)}px`)

    scrollHost.state.width = 1200
    latestResizeObserver().emit([{ target: scrollHost.el }])
    expect(offscreenState(slot.el).intrinsic).toBe(`${estimateMessageHeight(value, 1200)}px`)
  })

  it('restores the target and one screen of neighbours before locating', () => {
    controller.setEnabled(true)
    const values = Array.from({ length: 8 }, (_, index) => message(`m-${index}`, `第${index}条`))
    const tops = [0, 1000, 2000, 3000, 4000, 5000, 5500, 7000]
    const slots = values.map((value, index) =>
      makeSlot(scrollHost.el, value.id, { top: tops[index], height: index === 5 ? 300 : 100 }),
    )
    values.forEach((value, index) => controller.attach(value.id, slots[index].el, meta(value)))
    slots.forEach((slot) => expect(offscreenState(slot.el).visibility).toBe('hidden'))

    expect(controller.revealAround('m-5')).toBe(true)
    expect(offscreenState(slots[5].el).visibility).toBe('visible')
    expect(offscreenState(slots[6].el).visibility).toBe('visible')
    expect(offscreenState(slots[4].el).visibility).toBe('hidden')
    expect(offscreenState(slots[7].el).visibility).toBe('hidden')

    latestIntersectionObserver().emit([{ target: slots[5].el, isIntersecting: false }])
    expect(offscreenState(slots[5].el).visibility).toBe('visible')

    latestIntersectionObserver().emit([{ target: slots[5].el, isIntersecting: true }])
    latestIntersectionObserver().emit([{ target: slots[5].el, isIntersecting: false }])
    expect(offscreenState(slots[5].el).visibility).toBe('hidden')
  })
})
