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

type Operation = { op: 'read' | 'write'; el: HTMLElement }
type OperationLog = Operation[]

function instrumentRectReads(el: HTMLElement, log: OperationLog): void {
  const original = el.getBoundingClientRect.bind(el)
  el.getBoundingClientRect = () => {
    log.push({ op: 'read', el })
    return original()
  }
}

function instrumentWrites(el: HTMLElement, log: OperationLog): void {
  const style = el.style as any
  const setProperty = style.setProperty.bind(style)
  const removeProperty = style.removeProperty.bind(style)
  style.setProperty = (property: string, value: string | null) => {
    log.push({ op: 'write', el })
    setProperty(property, value)
  }
  style.removeProperty = (property: string) => {
    log.push({ op: 'write', el })
    return removeProperty(property)
  }
  const setAttribute = el.setAttribute.bind(el)
  el.setAttribute = (name: string, value: string) => {
    log.push({ op: 'write', el })
    setAttribute(name, value)
  }
}

function operationRuns(log: OperationLog) {
  const runs: Array<{ op: 'read' | 'write'; count: number }> = []
  for (const entry of log) {
    const last = runs[runs.length - 1]
    if (last && last.op === entry.op) last.count += 1
    else runs.push({ op: entry.op, count: 1 })
  }
  return runs
}

describe('message offscreen controller batching', () => {
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
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('attaches offscreen entries without reading layout', () => {
    controller.setEnabled(true)
    const log: OperationLog = []
    instrumentRectReads(scrollHost.el, log)
    const count = 8
    for (let index = 0; index < count; index++) {
      const value = message(`m-${index}`)
      const slot = makeSlot(scrollHost.el, value.id, { top: 1200 + index * 400, height: 200 })
      instrumentRectReads(slot.el, log)
      instrumentWrites(slot.el, log)
      controller.attach(value.id, slot.el, meta(value))
      expect(offscreenState(slot.el).visibility).toBe('hidden')
    }
    expect(log.filter((entry) => entry.op === 'read')).toHaveLength(0)
    expect(log.filter((entry) => entry.op === 'write').length).toBeGreaterThanOrEqual(count * 3)
  })

  it('measures each newly rendered entry once per phase and groups all writes together', () => {
    controller.setEnabled(true)
    const log: OperationLog = []
    instrumentRectReads(scrollHost.el, log)
    const count = 6
    const slots = Array.from({ length: count }, (_, index) => {
      const value = message(`m-${index}`)
      const slot = makeSlot(scrollHost.el, value.id, { top: 1200 + index * 600, height: 200 })
      instrumentRectReads(slot.el, log)
      instrumentWrites(slot.el, log)
      controller.attach(value.id, slot.el, meta(value))
      return slot
    })
    log.length = 0
    const computedStyleSpy = vi.spyOn(globalThis, 'getComputedStyle')

    latestIntersectionObserver().emit(slots.map((slot) => ({ target: slot.el, isIntersecting: true })))

    // 预读：容器内容顶部 1 次 + 每个条目 1 次；写后为每个新渲染条目统一补采 1 次。
    for (const slot of slots) {
      const ownReads = log.filter((entry) => entry.op === 'read' && entry.el === slot.el)
      expect(ownReads).toHaveLength(2)
      expect(offscreenState(slot.el).visibility).toBe('visible')
    }
    expect(log.filter((entry) => entry.op === 'read' && entry.el === scrollHost.el)).toHaveLength(1)
    expect(log.filter((entry) => entry.op === 'read')).toHaveLength(count * 2 + 1)

    const writeRuns = operationRuns(log).filter((run) => run.op === 'write')
    expect(writeRuns).toHaveLength(1)
    expect(writeRuns[0].count).toBeGreaterThanOrEqual(count * 3)
    const firstWrite = log.findIndex((entry) => entry.op === 'write')
    const lastWrite = log.map((entry) => entry.op).lastIndexOf('write')
    expect(log.slice(firstWrite, lastWrite + 1).every((entry) => entry.op === 'write')).toBe(true)

    // 写入阶段结束后只允许一次成组的高度补采：每个新渲染条目恰好一次。
    const postWriteReads = log.slice(lastWrite + 1).filter((entry) => entry.op === 'read')
    expect(postWriteReads).toHaveLength(count)
    expect(computedStyleSpy.mock.calls.length).toBeLessThanOrEqual(1)
  })

  it('does not measure unchanged offscreen placeholders during reconcile', () => {
    const value = message('m-1')
    const slot = makeSlot(scrollHost.el, 'm-1', { top: 1600, height: 300 })
    controller.attach('m-1', slot.el, meta(value))
    const log: OperationLog = []
    instrumentRectReads(scrollHost.el, log)
    instrumentRectReads(slot.el, log)
    const computedStyleSpy = vi.spyOn(globalThis, 'getComputedStyle')

    controller.setEnabled(true)

    expect(log.filter((entry) => entry.op === 'read')).toHaveLength(0)
    expect(computedStyleSpy).not.toHaveBeenCalled()
    expect(offscreenState(slot.el).visibility).toBe('hidden')
  })

  it('compensates multiple above-viewport height changes with one measurement round', () => {
    controller.setEnabled(true)
    scrollHost.state.scrollTop = 2000
    const values = [message('m-a'), message('m-b')]
    const slots = values.map((value, index) =>
      makeSlot(scrollHost.el, value.id, { top: -500 - index * 400, height: 300 }),
    )
    values.forEach((value, index) => controller.attach(value.id, slots[index].el, meta(value)))
    const log: OperationLog = []
    instrumentRectReads(scrollHost.el, log)
    slots.forEach((slot) => {
      instrumentRectReads(slot.el, log)
      instrumentWrites(slot.el, log)
    })

    latestIntersectionObserver().emit(slots.map((slot) => ({ target: slot.el, isIntersecting: true })))
    const estimate = estimateMessageHeight(values[0], 800)
    expect(scrollHost.state.scrollTop).toBe(2000 + 2 * (300 - estimate))

    slots.forEach((slot) => {
      slot.state.height = 500
    })
    const beforeHide = scrollHost.state.scrollTop
    log.length = 0
    const computedStyleSpy = vi.spyOn(globalThis, 'getComputedStyle')
    latestIntersectionObserver().emit(slots.map((slot) => ({ target: slot.el, isIntersecting: false })))

    expect(scrollHost.state.scrollTop).toBe(beforeHide - 2 * (500 - 300))
    slots.forEach((slot) => expect(offscreenState(slot.el).intrinsic).toBe('300px'))
    expect(log.filter((entry) => entry.op === 'read')).toHaveLength(slots.length + 1)
    expect(operationRuns(log).filter((run) => run.op === 'write')).toHaveLength(1)
    expect(computedStyleSpy).toHaveBeenCalledTimes(1)
  })

  it('keeps mixed above / visible / below decisions identical in one batch', () => {
    controller.setEnabled(true)
    const above = message('m-above')
    const visible = message('m-visible')
    const below = message('m-below')
    const aboveSlot = makeSlot(scrollHost.el, above.id, { top: -400, height: 200 })
    const visibleSlot = makeSlot(scrollHost.el, visible.id, { top: 100, height: 200 })
    const belowSlot = makeSlot(scrollHost.el, below.id, { top: 2000, height: 200 })
    const slots = [aboveSlot, visibleSlot, belowSlot]
    const values = [above, visible, below]
    values.forEach((value, index) => controller.attach(value.id, slots[index].el, meta(value)))

    latestIntersectionObserver().emit(slots.map((slot) => ({ target: slot.el, isIntersecting: true })))
    slots.forEach((slot) => expect(offscreenState(slot.el).visibility).toBe('visible'))

    latestIntersectionObserver().emit(slots.map((slot) => ({ target: slot.el, isIntersecting: false })))
    aboveSlot.state.height = 260
    visibleSlot.state.height = 260
    belowSlot.state.height = 260
    latestIntersectionObserver().emit(slots.map((slot) => ({ target: slot.el, isIntersecting: false })))
    slots.forEach((slot) => expect(offscreenState(slot.el).visibility).toBe('hidden'))
  })
})
