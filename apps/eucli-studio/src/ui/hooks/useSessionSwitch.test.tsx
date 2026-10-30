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

  // 回归：冷启动时 selectedChatId 来自索引偏好，而正文还没加载。
  // 旧实现用 `activeChatId === selectedId` 判定就绪，两者结构上不可能相等，
  // 于是 renderChat 恒为 null、页面永不挂载、PAINTED 永不发出（首屏永久卡死）。
  it('冷启动首次自动选择：正文到达后必须能进入 PAINTED', async () => {
    const controller = makeController()
    let api: any = null
    const chatA = { id: 'a', messages: [] }

    // 第一帧：索引偏好已给出 'a'，但正文仍为 null。
    await act(async () => {
      root.render(<Harness controller={controller} activeChat={null} selectedChatId="a" onApi={(v) => { api = v }} />)
    })
    expect(api.renderChat).toBeNull()
    expect(api.switching).toBe(true)
    expect(api.visibleKey).toBe('')

    // 正文到达（selectedChatId 不变）：就绪判定必须成立。
    await act(async () => {
      root.render(<Harness controller={controller} activeChat={chatA} selectedChatId="a" onApi={(v) => { api = v }} />)
    })
    expect(api.renderChat).toBe(chatA)
    expect(api.loadedChatId).toBe('a')

    await act(async () => {
      api.notifyPainted('a')
    })
    expect(api.visibleKey).toBe('a')
    expect(api.switching).toBe(false)
  })

  // 冷启动另一种形态：索引偏好为空，正文先到。
  // 此时「已加载正文」本身就是目标，不得因 selectedChatId 为空而永不就绪。
  it('冷启动无索引偏好：正文即目标，同样能进入 PAINTED', async () => {
    const controller = makeController()
    let api: any = null
    const chatA = { id: 'a', messages: [] }

    await act(async () => {
      root.render(<Harness controller={controller} activeChat={chatA} selectedChatId="" onApi={(v) => { api = v }} />)
    })
    expect(api.selectedChatId).toBe('a')
    expect(api.renderChat).toBe(chatA)

    await act(async () => {
      api.notifyPainted('a')
    })
    expect(api.visibleKey).toBe('a')
    expect(api.switching).toBe(false)
  })

  // 回归：索引偏好指向一个已失效会话时，控制器可能已经把另一个会话加载出来。
  // 旧实现用「selectedId === loadedChatId」当就绪条件，正文已经在了也永远判不就绪，
  // 页面永不挂载、PAINTED 永不发出 —— 这正是首屏永久卡死的机制。
  // 现在就绪只看「正文是否存在」，目标与正文是两个独立维度。
  it('正文存在即就绪：不因为目标与正文不同步而卡在未就绪', async () => {
    const controller = makeController()
    let api: any = null
    const chatA = { id: 'a', messages: [] }

    await act(async () => {
      root.render(<Harness controller={controller} activeChat={chatA} selectedChatId="stale" onApi={(v) => { api = v }} />)
    })
    expect(api.loadedChatId).toBe('a')
    expect(api.renderChat).toBe(chatA)
  })

  // 切换期间：目标先到、正文后到，旧正文继续垫底，新正文到达后才推进。
  it('目标先于正文到达时旧页继续可见，正文到达后可完成切换', async () => {
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

    // 用户点 b：切换请求立刻成为目标，正文仍是 a。
    // （真实链路里目标只能由 requestSwitch 产生：App 传入的偏好本身就是
    //  activeChat.id 优先，正文没换时它不会先变。）
    await act(async () => {
      api.requestSwitch('b')
    })
    expect(api.selectedChatId).toBe('b')
    expect(api.loadedChatId).toBe('a')
    expect(api.renderChat).toBe(chatA)
    expect(api.visibleKey).toBe('a')
    expect(api.switching).toBe(true)

    // 正文到达 b：可以绘制，PAINTED 后可见页推进。
    await act(async () => {
      root.render(<Harness controller={controller} activeChat={chatB} selectedChatId="b" onApi={(v) => { api = v }} />)
    })
    expect(api.renderChat).toBe(chatB)
    await act(async () => {
      api.notifyPainted('b')
    })
    expect(api.visibleKey).toBe('b')
    expect(api.switching).toBe(false)
  })

  // 失败终态：正文永远等不到时必须收敛到可重试状态，而不是一直「正在打开…」。
  it('正文加载失败后进入失败终态，并可重试', async () => {
    const controller = makeController()
    let api: any = null
    const chatA = { id: 'a', messages: [] }

    await act(async () => {
      root.render(<Harness controller={controller} activeChat={chatA} selectedChatId="a" onApi={(v) => { api = v }} />)
    })
    await act(async () => {
      api.notifyPainted('a')
    })
    expect(api.switching).toBe(false)

    // 切到 b 后加载失败。
    await act(async () => {
      api.requestSwitch('b')
    })
    expect(api.switching).toBe(true)

    await act(async () => {
      api.notifyLoadFailed(new Error('网络错误'))
    })
    // 失败是终态：不再是「切换中」，并带上真实原因。
    expect(api.switching).toBe(false)
    expect(api.failed).toBe(true)
    expect(api.failedReason).toBe('网络错误')
    // 旧页仍然可见（失败不该把用户已看到的内容顶掉）。
    expect(api.visibleKey).toBe('a')

    // 重试：清掉失败态并重新发起同一目标。
    await act(async () => {
      api.retryLoad()
    })
    expect(api.failed).toBe(false)
    expect(controller.actions.setActiveChat).toHaveBeenCalledWith('b')
  })

  // 失败态不能吞掉后续成功：正文到达即恢复。
  it('失败之后正文到达，失败态自动清除', async () => {
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
    await act(async () => {
      api.requestSwitch('b')
    })
    await act(async () => {
      api.notifyLoadFailed('数据损坏')
    })
    expect(api.failed).toBe(true)

    await act(async () => {
      root.render(<Harness controller={controller} activeChat={chatB} selectedChatId="b" onApi={(v) => { api = v }} />)
    })
    expect(api.failed).toBe(false)
    await act(async () => {
      api.notifyPainted('b')
    })
    expect(api.visibleKey).toBe('b')
    expect(api.switching).toBe(false)
  })
})
