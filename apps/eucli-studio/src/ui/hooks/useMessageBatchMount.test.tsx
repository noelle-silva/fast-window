// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMessageBatchMount } from './useMessageBatchMount'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

function messages(count: number, prefix = 'm') {
  return Array.from({ length: count }, (_, index) => ({ id: `${prefix}-${index}` }))
}

function visibleIds(apiRef: React.MutableRefObject<any>) {
  return apiRef.current.visibleMessages.map((message: any) => message.id)
}

function batchIds(apiRef: React.MutableRefObject<any>) {
  return apiRef.current.batchGroups.map((group: any) => ({
    revealed: group.revealed,
    ids: group.messages.map((message: any) => message.id),
  }))
}

function Harness(props: {
  sessionKey: string
  messages: any[]
  scrollRef: React.RefObject<HTMLDivElement>
  apiRef: React.MutableRefObject<any>
}) {
  const mounted = useMessageBatchMount({
    sessionKey: props.sessionKey,
    messages: props.messages,
    scrollRef: props.scrollRef,
  })
  props.apiRef.current = mounted
  return (
    <div ref={props.scrollRef}>
      {mounted.batchGroups.map((group, groupIndex) => (
        <div key={group.key} data-fw-message-batch={group.revealed ? 'revealed' : 'staging'}>
          {group.messages.map((message, index) => (
            <div key={`${groupIndex}:${index}:${message.id}`} data-mid={message.id}>
              {message.id}
            </div>
          ))}
        </div>
      ))}
      {mounted.visibleMessages.map((message, index) => (
        <div key={`tail:${index}:${message.id}`} data-mid={message.id}>
          {message.id}
        </div>
      ))}
    </div>
  )
}

describe('message batch mount', () => {
  let host: HTMLDivElement | null = null
  let root: any = null
  let apiRef: React.MutableRefObject<any> = { current: null }
  let scrollRef: React.RefObject<HTMLDivElement> = React.createRef<HTMLDivElement>()

  beforeEach(() => {
    vi.useFakeTimers()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    apiRef = { current: null }
    scrollRef = React.createRef<HTMLDivElement>()
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
    vi.useRealTimers()
  })

  async function render(sessionKey: string, list: any[]) {
    await act(async () => {
      root.render(<Harness sessionKey={sessionKey} messages={list} scrollRef={scrollRef} apiRef={apiRef} />)
    })
  }

  async function advance(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms)
    })
  }

  async function settleUntil(predicate: () => boolean, maxFrames = 500) {
    for (let frame = 0; frame < maxFrames; frame++) {
      if (predicate()) return
      await advance(20)
    }
    throw new Error('message batch mount did not settle')
  }

  it('shows only the latest five messages first and scrolls to the latest message', async () => {
    await render('chat-a', messages(37))
    expect(visibleIds(apiRef)).toEqual(['m-32', 'm-33', 'm-34', 'm-35', 'm-36'])
    expect(batchIds(apiRef)).toEqual([])

    const el = scrollRef.current as HTMLDivElement
    Object.defineProperty(el, 'scrollHeight', { configurable: true, value: 1234 })
    await advance(20)
    expect(el.scrollTop).toBe(1234)
  })

  it('yields at least eighty milliseconds after the previous batch is on screen', async () => {
    await render('chat-a', messages(8))
    await advance(20)
    expect(batchIds(apiRef)).toEqual([])

    await advance(60)
    expect(batchIds(apiRef)).toEqual([])

    await advance(40)
    expect(batchIds(apiRef)).toEqual([{ revealed: false, ids: ['m-0', 'm-1', 'm-2'] }])
  })

  it('assembles each old batch offscreen before revealing it above the current content', async () => {
    await render('chat-a', messages(37))
    await settleUntil(() => batchIds(apiRef).length === 1)

    expect(batchIds(apiRef)).toEqual([
      {
        revealed: false,
        ids: ['m-22', 'm-23', 'm-24', 'm-25', 'm-26', 'm-27', 'm-28', 'm-29', 'm-30', 'm-31'],
      },
    ])
    expect(host!.querySelector('[data-fw-message-batch="staging"]')).not.toBeNull()

    await settleUntil(() => !!batchIds(apiRef)[0]?.revealed)
    expect(batchIds(apiRef)).toEqual([
      {
        revealed: true,
        ids: ['m-22', 'm-23', 'm-24', 'm-25', 'm-26', 'm-27', 'm-28', 'm-29', 'm-30', 'm-31'],
      },
    ])
    expect(visibleIds(apiRef)).toEqual(['m-32', 'm-33', 'm-34', 'm-35', 'm-36'])
  })

  it('mounts all old batches from nearest to oldest', async () => {
    await render('chat-a', messages(37))
    await settleUntil(() => {
      const batches = batchIds(apiRef)
      return batches.length === 4 && batches.every((batch: any) => batch.revealed)
    })

    expect(batchIds(apiRef)).toEqual([
      { revealed: true, ids: ['m-0', 'm-1'] },
      { revealed: true, ids: ['m-2', 'm-3', 'm-4', 'm-5', 'm-6', 'm-7', 'm-8', 'm-9', 'm-10', 'm-11'] },
      { revealed: true, ids: ['m-12', 'm-13', 'm-14', 'm-15', 'm-16', 'm-17', 'm-18', 'm-19', 'm-20', 'm-21'] },
      { revealed: true, ids: ['m-22', 'm-23', 'm-24', 'm-25', 'm-26', 'm-27', 'm-28', 'm-29', 'm-30', 'm-31'] },
    ])
  })

  it('shows messages that arrive after opening immediately without batching them', async () => {
    await render('chat-a', messages(8))
    expect(visibleIds(apiRef)).toEqual(['m-3', 'm-4', 'm-5', 'm-6', 'm-7'])

    await settleUntil(() => batchIds(apiRef).length === 1)
    expect(batchIds(apiRef)).toEqual([{ revealed: false, ids: ['m-0', 'm-1', 'm-2'] }])

    await render('chat-a', messages(9))

    expect(visibleIds(apiRef)).toEqual(['m-3', 'm-4', 'm-5', 'm-6', 'm-7', 'm-8'])
    expect(batchIds(apiRef)).toEqual([{ revealed: false, ids: ['m-0', 'm-1', 'm-2'] }])

    await settleUntil(() => !!batchIds(apiRef)[0]?.revealed)
    expect(batchIds(apiRef)).toEqual([{ revealed: true, ids: ['m-0', 'm-1', 'm-2'] }])
    expect(visibleIds(apiRef)).toEqual(['m-3', 'm-4', 'm-5', 'm-6', 'm-7', 'm-8'])
  })

  it('drops the pending batches of the previous session immediately', async () => {
    await render('chat-a', messages(25, 'a'))
    await settleUntil(() => batchIds(apiRef).length === 1)
    expect(batchIds(apiRef)[0].ids).toEqual([
      'a-10', 'a-11', 'a-12', 'a-13', 'a-14', 'a-15', 'a-16', 'a-17', 'a-18', 'a-19',
    ])

    await render('chat-b', messages(12, 'b'))
    expect(visibleIds(apiRef)).toEqual(['b-7', 'b-8', 'b-9', 'b-10', 'b-11'])
    expect(batchIds(apiRef)).toEqual([])

    await settleUntil(() => {
      const batches = batchIds(apiRef)
      return batches.length === 1 && batches[0].revealed
    })
    expect(batchIds(apiRef)).toEqual([{ revealed: true, ids: ['b-0', 'b-1', 'b-2', 'b-3', 'b-4', 'b-5', 'b-6'] }])
    expect(visibleIds(apiRef)).toEqual(['b-7', 'b-8', 'b-9', 'b-10', 'b-11'])
  })

  it('never mounts the same message twice', async () => {
    const list = [...messages(12), { id: 'm-12' }, { id: 'm-12' }, { id: 'm-13' }, { id: 'm-14' }]
    await render('chat-a', list)
    await settleUntil(() => {
      const batches = batchIds(apiRef)
      return batches.length === 2 && batches.every((batch: any) => batch.revealed)
    })

    const ids = host!.querySelectorAll('[data-mid]')
    const rendered = Array.from(ids).map((node) => node.getAttribute('data-mid'))
    expect(new Set(rendered).size).toBe(rendered.length)
    expect(rendered.length).toBe(15)
  })

  it('compensates the scroll position by the inserted batch height', async () => {
    await render('chat-a', messages(8))
    await settleUntil(() => batchIds(apiRef).length === 1)

    const el = scrollRef.current as HTMLDivElement
    const anchor = host!.querySelector('[data-mid="m-3"]') as HTMLElement
    let rectCalls = 0
    anchor.getBoundingClientRect = () => ({ top: rectCalls++ === 0 ? 40 : 240 }) as DOMRect

    await settleUntil(() => !!batchIds(apiRef)[0]?.revealed)

    expect(rectCalls).toBeGreaterThanOrEqual(2)
    expect(el.scrollTop).toBe(200)
  })
})
