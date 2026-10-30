// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionSwitch } from './useSessionSwitch'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

function Harness(props: {
  controller: any
  activeChat: any
  selectedChatId: string
  onApi: (api: any) => void
}) {
  const api = useSessionSwitch(props.controller, props.activeChat, props.selectedChatId)
  props.onApi(api)
  return <div data-visible={api.visibleKey} data-switching={api.switching ? '1' : '0'} />
}

function makeController() {
  return { actions: { setActiveChat: vi.fn() } }
}

describe('useSessionSwitch', () => {
  let host: HTMLDivElement | null = null
  let root: any = null

  beforeEach(() => {
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
  })

  it('可见页只在 PAINTED 之后推进，BODY_READY 不推进', async () => {
    const controller = makeController()
    let api: any = null
    const chatA = { id: 'a', messages: [] }

    await act(async () => {
      root.render(<Harness controller={controller} activeChat={chatA} selectedChatId="a" onApi={(v) => { api = v }} />)
    })
    // 数据就绪，但还没绘制：可见页仍为空，需要骨架。
    expect(api.visibleKey).toBe('')
    expect(api.renderChat).toBe(chatA)
    expect(api.switching).toBe(true)
    expect(api.needsSkeleton).toBe(true)

    await act(async () => {
      api.notifyPainted('a')
    })
    expect(api.visibleKey).toBe('a')
    expect(api.switching).toBe(false)
    expect(api.needsSkeleton).toBe(false)
  })

  it('切换期间旧页保持可见，新页数据就绪也不抢画面', async () => {
    const controller = makeController()
    let api: any = null
    const chatA = { id: 'a', messages: [] }
    const chatB = { id: 'b', messages: [] }

    await act(async () => {
      root.render(<Harness controller={controller} activeChat={chatA} selectedChatId="a" onApi={(v) => { api = v }} />)
    })
    await act(async () => {
      api.notifyPainted('a')
    })
    expect(api.visibleKey).toBe('a')

    // 选中 b，数据已就绪。
    await act(async () => {
      root.render(<Harness controller={controller} activeChat={chatB} selectedChatId="b" onApi={(v) => { api = v }} />)
    })
    expect(api.visibleKey).toBe('a')
    expect(api.switching).toBe(true)
    expect(api.needsSkeleton).toBe(false)

    await act(async () => {
      api.notifyPainted('b')
    })
    expect(api.visibleKey).toBe('b')
    expect(api.switching).toBe(false)
  })

  it('迟到的 PAINTED 不会把可见页拉回旧会话', async () => {
    const controller = makeController()
    let api: any = null
    const chatA = { id: 'a', messages: [] }
    const chatB = { id: 'b', messages: [] }
    const chatC = { id: 'c', messages: [] }

    await act(async () => {
      root.render(<Harness controller={controller} activeChat={chatA} selectedChatId="a" onApi={(v) => { api = v }} />)
    })
    await act(async () => {
      api.notifyPainted('a')
    })

    // A → B → C 快速切换。
    await act(async () => {
      root.render(<Harness controller={controller} activeChat={chatB} selectedChatId="b" onApi={(v) => { api = v }} />)
    })
    await act(async () => {
      root.render(<Harness controller={controller} activeChat={chatC} selectedChatId="c" onApi={(v) => { api = v }} />)
    })

    // B 的迟到绘制通知被丢弃。
    await act(async () => {
      api.notifyPainted('b')
    })
    expect(api.visibleKey).toBe('a')

    await act(async () => {
      api.notifyPainted('c')
    })
    expect(api.visibleKey).toBe('c')
  })

  it('requestSwitch 不再包 startTransition，直接写控制器', () => {
    const controller = makeController()
    let api: any = null
    act(() => {
      root.render(<Harness controller={controller} activeChat={{ id: 'a', messages: [] }} selectedChatId="a" onApi={(v) => { api = v }} />)
    })
    act(() => {
      api.requestSwitch('b')
    })
    expect(controller.actions.setActiveChat).toHaveBeenCalledWith('b')
  })
})
