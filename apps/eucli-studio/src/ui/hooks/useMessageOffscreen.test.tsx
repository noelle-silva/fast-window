// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { messageHeightMemory, messageOffscreenContentKey } from '../../domain/messageOffscreen'
import { useMessageOffscreen } from './useMessageOffscreen'
import { MessageOffscreenSlot } from '../components/MessageOffscreenSlot'
import { MessageOffscreenController } from '../components/messageOffscreenController'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = []
  callback: IntersectionObserverCallback
  targets = new Set<Element>()

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback
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
  callback: ResizeObserverCallback

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
  }

  observe() {}

  unobserve() {}

  disconnect() {}

  emit(entries: Array<{ target: Element }>) {
    this.callback(entries as any, this as any)
  }
}

function latestIntersectionObserver() {
  const instance = FakeIntersectionObserver.instances[FakeIntersectionObserver.instances.length - 1]
  if (!instance) throw new Error('intersection observer was not created')
  return instance
}

function prepareScroll(el: HTMLDivElement) {
  const state = { width: 800, height: 600 }
  Object.defineProperty(el, 'clientWidth', { configurable: true, get: () => state.width })
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => state.height })
  el.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, bottom: state.height, left: 0, right: state.width, width: state.width, height: state.height, toJSON: () => ({}) }) as DOMRect
}

function Harness(props: {
  pageId?: string
  enabled: boolean
  layoutSignature: string
  messages: any[]
  scrollRef: React.MutableRefObject<HTMLDivElement | null>
  revealMessageRef?: React.MutableRefObject<((mid: string) => void) | null>
}) {
  const { handle, attachScrollElement } = useMessageOffscreen({
    enabled: props.enabled,
    layoutSignature: props.layoutSignature,
    revealMessageRef: props.revealMessageRef,
  })
  const setScrollRef = React.useCallback(
    (el: HTMLDivElement | null) => {
      props.scrollRef.current = el
      if (el) prepareScroll(el)
      attachScrollElement(el)
    },
    [attachScrollElement, props.scrollRef],
  )
  return (
    <div ref={setScrollRef} data-page={props.pageId}>
      {props.messages.map((message) => (
        <MessageOffscreenSlot
          key={message.id}
          controller={handle}
          mid={message.id}
          pinned={!!message.pinned}
          contentKey={messageOffscreenContentKey(message)}
          message={message}
        >
          <div>{message.content}</div>
        </MessageOffscreenSlot>
      ))}
    </div>
  )
}

describe('useMessageOffscreen', () => {
  let host: HTMLDivElement | null = null
  let root: any = null
  let scrollRef: React.MutableRefObject<HTMLDivElement | null> = React.createRef<HTMLDivElement>()

  beforeEach(() => {
    FakeIntersectionObserver.instances = []
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    messageHeightMemory.clear()
    scrollRef = { current: null }
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root.unmount()
      })
      root = null
    }
    host?.remove()
    host = null
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  async function render(enabled: boolean, layoutSignature: string, messages: any[]) {
    await act(async () => {
      root.render(<Harness enabled={enabled} layoutSignature={layoutSignature} messages={messages} scrollRef={scrollRef} />)
    })
  }

  function slot(mid: string) {
    return host!.querySelector(`[data-fw-message-slot="${mid}"]`) as HTMLElement | null
  }

  it('observes only active pages and keeps message nodes while toggling activation', async () => {
    const messages = [
      { id: 'm-1', role: 'assistant', content: '第一条' },
      { id: 'm-2', role: 'assistant', content: '第二条' },
    ]
    await render(true, 'layout-a', messages)

    expect(FakeIntersectionObserver.instances.length).toBe(1)
    expect(latestIntersectionObserver().targets.has(slot('m-1')!)).toBe(true)
    expect(latestIntersectionObserver().targets.has(slot('m-2')!)).toBe(true)

    await act(async () => {
      latestIntersectionObserver().emit([{ target: slot('m-1')!, isIntersecting: true }])
    })
    expect(slot('m-1')?.style.getPropertyValue('content-visibility')).toBe('visible')
    expect(slot('m-2')?.style.getPropertyValue('content-visibility')).toBe('hidden')

    const firstObserver = latestIntersectionObserver()
    await render(false, 'layout-a', messages)
    expect(firstObserver.targets.size).toBe(0)
    expect(slot('m-1')).not.toBeNull()
    expect(slot('m-2')).not.toBeNull()

    await render(true, 'layout-b', messages)
    expect(FakeIntersectionObserver.instances.length).toBe(2)
    expect(latestIntersectionObserver()).not.toBe(firstObserver)
    expect(latestIntersectionObserver().targets.has(slot('m-2')!)).toBe(true)
  })

  it('keeps pinned slots rendered and passes layout conditions through the controller', async () => {
    const messages = [
      { id: 'm-1', role: 'assistant', content: '普通消息' },
      { id: 'm-2', role: 'assistant', content: '生成中的消息', pinned: true },
    ]
    await render(true, 'layout-a', messages)

    expect(slot('m-2')?.style.getPropertyValue('content-visibility')).toBe('visible')
    await act(async () => {
      latestIntersectionObserver().emit([{ target: slot('m-2')!, isIntersecting: false }])
    })
    expect(slot('m-2')?.style.getPropertyValue('content-visibility')).toBe('visible')
  })

  it('re-registers the shared jump entry for the page that becomes active', async () => {
    const revealMessageRef: React.MutableRefObject<((mid: string) => void) | null> = { current: null }
    const pageARef: React.MutableRefObject<HTMLDivElement | null> = { current: null }
    const pageBRef: React.MutableRefObject<HTMLDivElement | null> = { current: null }
    const revealTargets: Array<HTMLElement | null> = []
    vi.spyOn(MessageOffscreenController.prototype, 'revealAround').mockImplementation(function (this: MessageOffscreenController, _mid: string) {
      revealTargets.push((this as any).scrollEl as HTMLElement | null)
      return true
    })

    const renderPages = async (active: 'a' | 'b') => {
      await act(async () => {
        root.render(
          <>
            <Harness
              pageId="a"
              enabled={active === 'a'}
              layoutSignature="layout-a"
              messages={[{ id: 'a-1', role: 'assistant', content: 'A' }]}
              scrollRef={pageARef}
              revealMessageRef={revealMessageRef}
            />
            <Harness
              pageId="b"
              enabled={active === 'b'}
              layoutSignature="layout-a"
              messages={[{ id: 'b-1', role: 'assistant', content: 'B' }]}
              scrollRef={pageBRef}
              revealMessageRef={revealMessageRef}
            />
          </>
        )
      })
    }

    await renderPages('a')
    revealMessageRef.current?.('a-1')
    expect(revealTargets.at(-1)).toBe(pageARef.current)

    await renderPages('b')
    revealMessageRef.current?.('b-1')
    expect(revealTargets.at(-1)).toBe(pageBRef.current)

    await renderPages('a')
    revealMessageRef.current?.('a-1')
    expect(revealTargets.at(-1)).toBe(pageARef.current)
  })
})
