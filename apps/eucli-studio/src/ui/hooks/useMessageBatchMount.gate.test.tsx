// @vitest-environment happy-dom
//
// pageActive 门控：隐藏页不得推进分批上屏，也不得安排任何定时器。
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMessageBatchMount } from './useMessageBatchMount'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

function makeMessages(count: number) {
  return Array.from({ length: count }, (_, index) => ({ id: `m-${index}`, content: `内容 ${index}` }))
}

function Harness(props: { sessionKey: string; messages: any[]; active: boolean; apiRef: React.MutableRefObject<any> }) {
  const scrollRef = React.useRef<HTMLDivElement | null>(null)
  const plan = useMessageBatchMount({
    sessionKey: props.sessionKey,
    messages: props.messages,
    scrollRef,
    active: props.active,
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

  it('隐藏页不排队、不触发 setTimeout（0 次）', async () => {
    vi.useFakeTimers()
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    const messages = makeMessages(40)

    await act(async () => {
      root.render(<Harness sessionKey="chat-1" messages={messages} active={false} apiRef={apiRef} />)
    })
    expect(apiRef.current.visibleMessages.length).toBeGreaterThan(0)

    const countBefore = apiRef.current.batchGroups.length
    await act(async () => {
      vi.advanceTimersByTime(2000)
    })
    expect(apiRef.current.batchGroups.length).toBe(countBefore)
    expect(setTimeoutSpy.mock.calls.length).toBe(0)
  })

  it('可见页会排队推进分批上屏（会安排定时器）', async () => {
    vi.useFakeTimers()
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb: any) => {
      cb(0)
      return 1
    })
    const messages = makeMessages(40)

    await act(async () => {
      root.render(<Harness sessionKey="chat-1" messages={messages} active apiRef={apiRef} />)
    })
    await act(async () => {
      vi.advanceTimersByTime(400)
    })

    expect(setTimeoutSpy.mock.calls.length).toBeGreaterThan(0)
    rafSpy.mockRestore()
  })
})
