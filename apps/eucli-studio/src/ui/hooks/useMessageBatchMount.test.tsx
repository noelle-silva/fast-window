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

function immediateYield() {
  return {
    promise: Promise.resolve(),
    cancel: () => {},
  }
}

// 可控时钟：每被读取一次就前进固定步长，用来让「帧预算」先于条数上限触发。
function steppedClock(step: number) {
  let value = 0
  return () => {
    const current = value
    value += step
    return current
  }
}

// 可控让出：第一次让出会挂起，测试可以观察「取消前的等待」并验证取消句柄。
function manualYield() {
  const cancel = vi.fn()
  let release: (() => void) | null = null
  let pending = false
  const yieldToMain = vi.fn(() => {
    pending = true
    const promise = new Promise<void>((resolve) => {
      release = () => {
        pending = false
        resolve()
      }
    })
    return {
      promise,
      cancel: () => {
        cancel()
        release?.()
      },
    }
  })
  return {
    yieldToMain,
    cancel,
    isPending: () => pending,
  }
}

function Harness(props: {
  sessionKey: string
  messages: any[]
  scrollRef: React.RefObject<HTMLDivElement>
  apiRef: React.MutableRefObject<any>
  active?: boolean
  frameBudget?: any
}) {
  const mounted = useMessageBatchMount({
    sessionKey: props.sessionKey,
    messages: props.messages,
    scrollRef: props.scrollRef,
    active: props.active,
    frameBudget: props.frameBudget,
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

  async function render(
    sessionKey: string,
    list: any[],
    options?: { active?: boolean; frameBudget?: any },
  ) {
    await act(async () => {
      root.render(
        <Harness
          sessionKey={sessionKey}
          messages={list}
          scrollRef={scrollRef}
          apiRef={apiRef}
          active={options?.active}
          frameBudget={options?.frameBudget}
        />,
      )
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

  it('按条数上限让出：默认一片最多十条', async () => {
    const frameBudget = { yieldToMain: immediateYield }
    await render('chat-a', messages(25), { frameBudget })
    await advance(20)

    await settleUntil(() => batchIds(apiRef).length === 1)
    expect(batchIds(apiRef)[0].ids).toEqual([
      'm-10', 'm-11', 'm-12', 'm-13', 'm-14', 'm-15', 'm-16', 'm-17', 'm-18', 'm-19',
    ])

    await settleUntil(() => batchIds(apiRef).length === 2)
    expect(batchIds(apiRef)[0].ids).toEqual(['m-0', 'm-1', 'm-2', 'm-3', 'm-4', 'm-5', 'm-6', 'm-7', 'm-8', 'm-9'])
    expect(batchIds(apiRef)[1].ids).toEqual([
      'm-10', 'm-11', 'm-12', 'm-13', 'm-14', 'm-15', 'm-16', 'm-17', 'm-18', 'm-19',
    ])
  })

  it('按帧预算让出：预算先到就切出更小的一片', async () => {
    const frameBudget = {
      now: steppedClock(6),
      frameLengthMs: 20,
      ratio: 0.5,
      yieldToMain: immediateYield,
    }
    await render('chat-a', messages(25), { frameBudget })
    await advance(20)

    await settleUntil(() => batchIds(apiRef).length === 1)
    expect(batchIds(apiRef)[0].ids).toEqual(['m-10', 'm-11'])
  })

  it('assembles each old batch offscreen before revealing it above the current content', async () => {
    const frameBudget = { yieldToMain: immediateYield }
    await render('chat-a', messages(37), { frameBudget })
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
    await render('chat-a', messages(37), { frameBudget: { yieldToMain: immediateYield } })
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
    const frameBudget = { yieldToMain: immediateYield }
    await render('chat-a', messages(8), { frameBudget })
    expect(visibleIds(apiRef)).toEqual(['m-3', 'm-4', 'm-5', 'm-6', 'm-7'])

    await settleUntil(() => batchIds(apiRef).length === 1)
    expect(batchIds(apiRef)).toEqual([{ revealed: false, ids: ['m-0', 'm-1', 'm-2'] }])

    await render('chat-a', messages(9), { frameBudget })

    expect(visibleIds(apiRef)).toEqual(['m-3', 'm-4', 'm-5', 'm-6', 'm-7', 'm-8'])
    expect(batchIds(apiRef)).toEqual([{ revealed: false, ids: ['m-0', 'm-1', 'm-2'] }])

    await settleUntil(() => !!batchIds(apiRef)[0]?.revealed)
    expect(batchIds(apiRef)).toEqual([{ revealed: true, ids: ['m-0', 'm-1', 'm-2'] }])
    expect(visibleIds(apiRef)).toEqual(['m-3', 'm-4', 'm-5', 'm-6', 'm-7', 'm-8'])
  })

  it('drops the pending batches of the previous session immediately', async () => {
    const frameBudget = { yieldToMain: immediateYield }
    await render('chat-a', messages(25, 'a'), { frameBudget })
    await settleUntil(() => batchIds(apiRef).length === 1)
    expect(batchIds(apiRef)[0].ids).toEqual([
      'a-10', 'a-11', 'a-12', 'a-13', 'a-14', 'a-15', 'a-16', 'a-17', 'a-18', 'a-19',
    ])

    await render('chat-b', messages(12, 'b'), { frameBudget })
    expect(visibleIds(apiRef)).toEqual(['b-7', 'b-8', 'b-9', 'b-10', 'b-11'])
    expect(batchIds(apiRef)).toEqual([])

    await settleUntil(() => {
      const batches = batchIds(apiRef)
      return batches.length === 1 && batches[0].revealed
    })
    expect(batchIds(apiRef)).toEqual([{ revealed: true, ids: ['b-0', 'b-1', 'b-2', 'b-3', 'b-4', 'b-5', 'b-6'] }])
    expect(visibleIds(apiRef)).toEqual(['b-7', 'b-8', 'b-9', 'b-10', 'b-11'])
  })

  it('会话切换时取消上一会话进行中的推进', async () => {
    const yieldControl = manualYield()
    await render('chat-a', messages(25, 'a'), { frameBudget: { yieldToMain: yieldControl.yieldToMain } })
    await settleUntil(() => !!batchIds(apiRef)[0]?.revealed)
    await advance(60)
    expect(yieldControl.isPending()).toBe(true)

    await render('chat-b', messages(12, 'b'), { frameBudget: { yieldToMain: yieldControl.yieldToMain } })
    expect(yieldControl.cancel).toHaveBeenCalled()
    expect(batchIds(apiRef)).toEqual([])

    await advance(200)
    expect(batchIds(apiRef).flatMap((batch: any) => batch.ids).some((id: string) => id.startsWith('a-'))).toBe(false)
  })

  it('隐藏页取消推进，恢复可见后从剩余历史继续', async () => {
    const yieldControl = manualYield()
    const frameBudget = { yieldToMain: yieldControl.yieldToMain }
    await render('chat-a', messages(25), { active: true, frameBudget })
    await settleUntil(() => !!batchIds(apiRef)[0]?.revealed)
    await advance(60)
    expect(yieldControl.isPending()).toBe(true)
    const before = batchIds(apiRef).length

    await render('chat-a', messages(25), { active: false, frameBudget })
    expect(yieldControl.cancel).toHaveBeenCalled()
    await advance(500)
    expect(batchIds(apiRef).length).toBe(before)

    await render('chat-a', messages(25), { active: true, frameBudget })
    await settleUntil(() => batchIds(apiRef).length > before)
  })

  it('锚点失效重置时取消进行中的推进', async () => {
    const yieldControl = manualYield()
    const frameBudget = { yieldToMain: yieldControl.yieldToMain }
    await render('chat-a', messages(25), { frameBudget })
    await settleUntil(() => !!batchIds(apiRef)[0]?.revealed)
    await advance(60)
    expect(yieldControl.isPending()).toBe(true)

    // m-20 是当前锚点；把它从列表里拿掉会触发锚点失效重置。
    const withoutAnchor = messages(25).filter((message) => message.id !== 'm-20')
    await render('chat-a', withoutAnchor, { frameBudget })

    expect(yieldControl.cancel).toHaveBeenCalled()
    expect(visibleIds(apiRef)).toEqual(['m-19', 'm-21', 'm-22', 'm-23', 'm-24'])
    // 旧计划的第一批是 m-10..m-19；重置后的新计划从 m-9 开始。
    expect(batchIds(apiRef)).toEqual([
      { revealed: false, ids: ['m-9', 'm-10', 'm-11', 'm-12', 'm-13', 'm-14', 'm-15', 'm-16', 'm-17', 'm-18'] },
    ])
  })

  it('卸载时取消进行中的推进，不遗留定时器', async () => {
    const yieldControl = manualYield()
    await render('chat-a', messages(25), { frameBudget: { yieldToMain: yieldControl.yieldToMain } })
    await settleUntil(() => !!batchIds(apiRef)[0]?.revealed)
    await advance(60)
    expect(yieldControl.isPending()).toBe(true)

    await act(async () => {
      root.unmount()
    })
    root = null

    expect(yieldControl.cancel).toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('never mounts the same message twice', async () => {
    const list = [...messages(12), { id: 'm-12' }, { id: 'm-12' }, { id: 'm-13' }, { id: 'm-14' }]
    await render('chat-a', list, { frameBudget: { yieldToMain: immediateYield } })
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
    await render('chat-a', messages(8), { frameBudget: { yieldToMain: immediateYield } })
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
