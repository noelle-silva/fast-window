// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Rendition } from 'epubjs'
import { attachEpubWheelNavigation, type EpubWheelNavigationHandle } from './epubWheelNavigation'

/**
 * 行为锁定测试（084 · 拆分期护栏）：
 * 用替身 rendition 驱动 rendered/removed 生命周期，观察表面与章节内容是否被正确挂载滚轮翻页。
 */

type Handler = (...args: unknown[]) => void

function makeRendition(contents: unknown) {
  const handlers = new Map<string, Set<Handler>>()
  return {
    getContents: vi.fn(() => contents),
    on: vi.fn((event: string, handler: Handler) => {
      const set = handlers.get(event) ?? new Set<Handler>()
      set.add(handler)
      handlers.set(event, set)
    }),
    off: vi.fn((event: string, handler: Handler) => {
      handlers.get(event)?.delete(handler)
    }),
    emit(event: string, ...args: unknown[]) {
      handlers.get(event)?.forEach(handler => handler(...args))
    },
  }
}

function makeContents() {
  const documentElement = document.createElement('div')
  return { contents: { document: { documentElement } }, documentElement }
}

function wheel(el: HTMLElement): WheelEvent {
  const event = new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true })
  el.dispatchEvent(event)
  return event
}

const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0))

const handles: EpubWheelNavigationHandle[] = []

afterEach(() => {
  handles.splice(0).forEach(handle => handle.destroy())
  document.body.innerHTML = ''
})

function attach(rendition: ReturnType<typeof makeRendition>, surface: HTMLElement) {
  const onPreviousPage = vi.fn()
  const onNextPage = vi.fn()
  const onError = vi.fn()
  const handle = attachEpubWheelNavigation({
    rendition: rendition as unknown as Rendition,
    surface,
    onPreviousPage,
    onNextPage,
    onError,
  })
  handles.push(handle)
  return { handle, onPreviousPage, onNextPage, onError }
}

describe('attachEpubWheelNavigation', () => {
  it('binds the surface, existing contents and later rendered contents', async () => {
    const { contents, documentElement } = makeContents()
    const rendition = makeRendition([contents])
    const surface = document.createElement('div')
    const { handle, onNextPage } = attach(rendition, surface)

    wheel(surface)
    await flush()
    expect(onNextPage).toHaveBeenCalledTimes(1)

    wheel(documentElement)
    await flush()
    expect(onNextPage).toHaveBeenCalledTimes(2)

    const later = makeContents()
    rendition.emit('rendered', {}, { contents: later.contents })
    wheel(later.documentElement)
    await flush()
    expect(onNextPage).toHaveBeenCalledTimes(3)

    rendition.emit('removed', {}, { contents: later.contents })
    wheel(later.documentElement)
    await flush()
    expect(onNextPage).toHaveBeenCalledTimes(3)

    handle.destroy()
    wheel(surface)
    wheel(documentElement)
    await flush()
    expect(onNextPage).toHaveBeenCalledTimes(3)
  })

  it('binds a single non-array contents object', async () => {
    const { contents, documentElement } = makeContents()
    const rendition = makeRendition(contents)
    const surface = document.createElement('div')
    const { onNextPage } = attach(rendition, surface)

    wheel(documentElement)
    await flush()
    expect(onNextPage).toHaveBeenCalledTimes(1)
  })

  it('filters falsy entries out of a contents array', async () => {
    const { contents, documentElement } = makeContents()
    const rendition = makeRendition([null, contents])
    const surface = document.createElement('div')
    const { onNextPage } = attach(rendition, surface)

    wheel(documentElement)
    await flush()
    expect(onNextPage).toHaveBeenCalledTimes(1)
  })

  it('does not bind when getContents returns nothing', async () => {
    const { contents, documentElement } = makeContents()
    const rendition = makeRendition(null)
    const surface = document.createElement('div')
    const { onNextPage } = attach(rendition, surface)

    wheel(documentElement)
    await flush()
    expect(onNextPage).not.toHaveBeenCalled()
    expect(contents).toBeDefined()
  })

  it('ignores repeated rendered events for the same contents', async () => {
    const { contents, documentElement } = makeContents()
    const rendition = makeRendition([])
    const surface = document.createElement('div')
    const { onNextPage } = attach(rendition, surface)

    rendition.emit('rendered', {}, { contents })
    rendition.emit('rendered', {}, { contents })
    wheel(documentElement)
    await flush()
    expect(onNextPage).toHaveBeenCalledTimes(1)
  })

  it('unregisters rendition listeners on destroy', () => {
    const rendition = makeRendition([])
    const surface = document.createElement('div')
    const { handle } = attach(rendition, surface)

    handle.destroy()

    expect(rendition.off).toHaveBeenCalledWith('rendered', expect.any(Function))
    expect(rendition.off).toHaveBeenCalledWith('removed', expect.any(Function))
  })
})
