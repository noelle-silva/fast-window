// @vitest-environment happy-dom
//
// pageActive 门控：隐藏页不得推进分批上屏，也不得采样帧长或安排让出。
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMessageBatchMount } from './useMessageBatchMount'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

function makeMessages(count: number) {
  return Array.from({ length: count }, (_, index) => ({ id: `m-${index}`, content: `内容 ${index}` }))
}

function immediateYield() {
  return {
    promise: Promise.resolve(),
    cancel: () => {},
  }
}

function Harness(props: {
  sessionKey: string
  messages: any[]
  active: boolean
  frameBudget?: any
  apiRef: React.MutableRefObject<any>
}) {
  const scrollRef = React.useRef<HTMLDivElement | null>(null)
  const plan = useMessageBatchMount({
    sessionKey: props.sessionKey,
    messages: props.messages,
    scrollRef,
    active: props.active,
    frameBudget: props.frameBudget,
  })
  props.apiRef.current = plan
  return <div ref={scrollRef} />
}

describe('useMessageBatchMount 的页面门控', () => {
  let host: HTMLDivElement | null = null
  let root: any = null
  let apiRef: React.MutableRefObject<any> = { current: null }

  beforeEach(() => {
    apiRef = { current: null }
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    vi.useFakeTimers()
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
    vi.restoreAllMocks()
  })

  it('隐藏页不推进、不采样帧长、不触发让出', async () => {
    const messages = makeMessages(40)
    const yieldToMain = vi.fn(immediateYield)
    const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame')

    await act(async () => {
      root.render(
        <Harness
          sessionKey="chat-1"
          messages={messages}
          active={false}
          frameBudget={{ yieldToMain }}
          apiRef={apiRef}
        />,
      )
    })
    expect(apiRef.current.visibleMessages.length).toBeGreaterThan(0)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })
    const framesBefore = rafSpy.mock.calls.length

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(apiRef.current.batchGroups.length).toBe(0)
    expect(yieldToMain).not.toHaveBeenCalled()
    expect(rafSpy.mock.calls.length).toBe(framesBefore)
  })

  it('可见页会按帧切片推进分批上屏', async () => {
    const messages = makeMessages(40)
    const yieldToMain = vi.fn(immediateYield)

    await act(async () => {
      root.render(
        <Harness sessionKey="chat-1" messages={messages} active frameBudget={{ yieldToMain }} apiRef={apiRef} />,
      )
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20)
    })
    expect(apiRef.current.batchGroups.length).toBe(1)

    for (let frame = 0; frame < 200; frame++) {
      const batches = apiRef.current.batchGroups
      if (batches.length === 4 && batches.every((batch: any) => batch.revealed)) break
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20)
      })
    }

    expect(apiRef.current.batchGroups.length).toBe(4)
    expect(apiRef.current.batchGroups.every((batch: any) => batch.revealed)).toBe(true)
    expect(yieldToMain).toHaveBeenCalled()
  })
})
