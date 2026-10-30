// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMessageBatchMount } from './useMessageBatchMount'

// 本仓库不引入 @testing-library/*：测试范式统一为
// react + react-dom/client + createRoot + act（参见 SessionPageStack.test.tsx）。
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

function message(id: string) {
  return { id, content: id }
}

function visibleIds(apiRef: React.MutableRefObject<any>) {
  return apiRef.current.visibleMessages.map((item: any) => item.id)
}

function batchIds(apiRef: React.MutableRefObject<any>) {
  return apiRef.current.batchGroups.map((group: any) => ({
    revealed: group.revealed,
    ids: group.messages.map((item: any) => item.id),
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
          {group.messages.map((item, index) => (
            <div key={`${groupIndex}:${index}:${item.id}`} data-mid={item.id}>
              {item.id}
            </div>
          ))}
        </div>
      ))}
      {mounted.visibleMessages.map((item, index) => (
        <div key={`tail:${index}:${item.id}`} data-mid={item.id}>
          {item.id}
        </div>
      ))}
    </div>
  )
}

describe('useMessageBatchMount 窗口翻页', () => {
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
    throw new Error('useMessageBatchMount 未在预期帧数内稳定')
  }

  it('翻页补进来的更早消息会进批次，已上屏内容不受影响', async () => {
    const tail = [message('m5'), message('m6'), message('m7')]
    await render('chat-1', tail)
    expect(visibleIds(apiRef)).toEqual(['m5', 'm6', 'm7'])
    expect(batchIds(apiRef)).toEqual([])

    // 往前翻一页：更早的消息插到列表最前面（anchor 之后仍是原来的尾部）。
    await render('chat-1', [message('m1'), message('m2'), ...tail])

    const grouped = batchIds(apiRef).flatMap((batch: any) => batch.ids)
    expect(grouped).toContain('m1')
    expect(grouped).toContain('m2')
    // 已上屏的尾部内容保持原样，不会因为翻页而重排或闪烁。
    expect(visibleIds(apiRef)).toEqual(['m5', 'm6', 'm7'])
  })

  it('翻页补进来的批次直接可见（用户主动要的更早历史）', async () => {
    const tail = [message('m5'), message('m6'), message('m7')]
    await render('chat-1', tail)

    await render('chat-1', [message('m1'), message('m2'), ...tail])

    const batches = batchIds(apiRef)
    expect(batches.length).toBeGreaterThan(0)
    for (const batch of batches) expect(batch.revealed).toBe(true)
  })

  it('重复翻页不会把同一条消息重复纳入批次', async () => {
    const tail = [message('m5'), message('m6'), message('m7')]
    await render('chat-1', tail)

    await render('chat-1', [message('m1'), message('m2'), ...tail])
    await render('chat-1', [message('m1'), message('m2'), ...tail])
    await render('chat-1', [message('m0'), message('m1'), message('m2'), ...tail])

    const grouped = batchIds(apiRef).flatMap((batch: any) => batch.ids)
    expect(new Set(grouped).size).toBe(grouped.length)
    expect(grouped).toContain('m0')
    expect(grouped).toContain('m1')
    expect(grouped).toContain('m2')
  })

  it('尾部新到的消息直接可见，不被当成更早历史放进批次', async () => {
    await render('chat-1', [message('m5'), message('m6'), message('m7')])
    expect(visibleIds(apiRef)).toEqual(['m5', 'm6', 'm7'])

    // 运行产生一条新消息：它属于尾部，必须立刻可见。
    await render('chat-1', [message('m5'), message('m6'), message('m7'), message('m8')])

    expect(visibleIds(apiRef)).toEqual(['m5', 'm6', 'm7', 'm8'])
    expect(batchIds(apiRef)).toEqual([])
  })

  it('翻页与尾部新增同时发生时，两者各自落到正确区域', async () => {
    const tail = [message('m5'), message('m6'), message('m7')]
    await render('chat-1', tail)

    // 一次更新里同时有「更早历史」和「新消息」。
    await render('chat-1', [message('m3'), message('m4'), ...tail, message('m8')])

    const grouped = batchIds(apiRef).flatMap((batch: any) => batch.ids)
    expect(grouped).toContain('m3')
    expect(grouped).toContain('m4')
    // 新消息不属于历史区。
    expect(grouped).not.toContain('m8')
    expect(visibleIds(apiRef)).toEqual(['m5', 'm6', 'm7', 'm8'])
  })

  it('切换会话后翻页状态重置，不沿用上一会话的批次', async () => {
    await render('chat-a', [message('a5'), message('a6')])
    await render('chat-a', [message('a3'), message('a4'), message('a5'), message('a6')])
    expect(batchIds(apiRef).flatMap((batch: any) => batch.ids)).toContain('a3')

    await render('chat-b', [message('b1'), message('b2')])
    expect(visibleIds(apiRef)).toEqual(['b1', 'b2'])
    expect(batchIds(apiRef)).toEqual([])
  })

  it('稳定后不会持续追加空批次', async () => {
    const tail = [message('m5'), message('m6')]
    await render('chat-1', tail)
    await render('chat-1', [message('m3'), message('m4'), ...tail])
    await settleUntil(() => batchIds(apiRef).length > 0)

    const before = batchIds(apiRef).length
    await advance(200)
    await advance(200)
    expect(batchIds(apiRef).length).toBe(before)
  })
})
