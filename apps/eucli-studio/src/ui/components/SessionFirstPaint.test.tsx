// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionSwitch } from '../hooks/useSessionSwitch'
import { useSessionKeepAlive } from '../hooks/useSessionKeepAlive'
import { SessionPageStack } from './SessionPageStack'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

// 首屏链路集成件：useSessionSwitch（选中/绘制状态机）+ useSessionKeepAlive（页面栈保活）
// + SessionPageStack（双 rAF 后上报 PAINTED）。这与 App.tsx 的装配顺序一致，
// 因此能覆盖「首屏永远不 PAINTED」这类跨模块死锁，而不只是单点语义。
function SessionPage(props: { id: string }) {
  return <div data-page-id={props.id}>{props.id}</div>
}

function AppLike(props: {
  controller: any
  activeChat: any
  selectedChatId: string
  onApi: (api: any) => void
}) {
  const chatSwitch = useSessionSwitch(props.controller, props.activeChat, props.selectedChatId)
  const pageKey =
    chatSwitch.renderChat && Array.isArray(chatSwitch.renderChat.messages) ? chatSwitch.renderChatId : ''
  const keepAliveKeys = useSessionKeepAlive(pageKey, { pinnedKey: chatSwitch.visibleKey })
  props.onApi(chatSwitch)
  return (
    <SessionPageStack
      activeKey={pageKey}
      visibleKey={chatSwitch.visibleKey}
      keys={keepAliveKeys}
      activePage={pageKey ? <SessionPage id={pageKey} /> : null}
      onPainted={chatSwitch.notifyPainted}
    />
  )
}

function makeController() {
  return { actions: { setActiveChat: vi.fn() } }
}

async function flushFrames() {
  // SessionPageStack 用双 rAF 表达「真正画出来」：这里推两帧。
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(null))))
  })
}

describe('冷启动首屏 PAINTED 链路', () => {
  let host: HTMLDivElement | null = null
  let root: any = null
  let api: any = null

  beforeEach(() => {
    api = null
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
  })

  // 本次死锁的端到端回归：
  // 索引偏好已给出 'a'（selectedChatId='a'），但首屏正文还没加载（activeChat=null）。
  // 旧实现把「selectedId === loadedChatId」当就绪条件，两者结构上不可能相等，
  // 于是 renderChat 恒 null、页面永不挂载、PAINTED 永不发出、进度条常驻。
  it('冷启动自动选择：正文到达后必须真正发出 PAINTED 并结束切换态', async () => {
    const controller = makeController()

    // 第一帧：有目标、无正文。
    await act(async () => {
      root.render(<AppLike controller={controller} activeChat={null} selectedChatId="a" onApi={(v) => { api = v }} />)
    })
    expect(api.renderChat).toBeNull()
    expect(api.visibleKey).toBe('')
    expect(api.switching).toBe(true)

    // 第二帧：正文到达（selectedChatId 不变，这正是冷启动的真实时序）。
    const chatA = { id: 'a', messages: [{ id: 'm1', role: 'assistant', content: 'hi' }] }
    await act(async () => {
      root.render(<AppLike controller={controller} activeChat={chatA} selectedChatId="a" onApi={(v) => { api = v }} />)
    })
    expect(api.renderChat).toBe(chatA)
    expect(api.renderChatId).toBe('a')

    // 页面必须真的挂载出来（否则双 rAF 永远拿不到 PAINTED）。
    expect(host!.querySelector('[data-page-id="a"]')).not.toBeNull()

    await flushFrames()

    expect(api.visibleKey).toBe('a')
    expect(api.switching).toBe(false)
    expect(host!.querySelector('[data-fw-session-page="active"] [data-page-id="a"]')).not.toBeNull()
  })

  // 另一种冷启动形态：没有索引偏好（selectedChatId 为空），正文先到。
  it('冷启动无索引偏好：正文即目标，同样必须发出 PAINTED', async () => {
    const controller = makeController()
    const chatA = { id: 'a', messages: [{ id: 'm1', role: 'assistant', content: 'hi' }] }

    await act(async () => {
      root.render(<AppLike controller={controller} activeChat={chatA} selectedChatId="" onApi={(v) => { api = v }} />)
    })
    expect(api.selectedChatId).toBe('a')
    expect(api.renderChat).toBe(chatA)

    await flushFrames()

    expect(api.visibleKey).toBe('a')
    expect(api.switching).toBe(false)
  })

  // 冷启动时目标与正文都属于「同一会话」但到达顺序相反，也不得卡住。
  it('冷启动正文先于目标到达：目标确认后仍然收敛到 PAINTED', async () => {
    const controller = makeController()
    const chatA = { id: 'a', messages: [{ id: 'm1', role: 'assistant', content: 'hi' }] }

    await act(async () => {
      root.render(<AppLike controller={controller} activeChat={chatA} selectedChatId="" onApi={(v) => { api = v }} />)
    })
    await flushFrames()
    expect(api.visibleKey).toBe('a')

    // 控制器随后确认偏好：目标从 '' 收敛为 'a'，不得回到「未绘制」。
    await act(async () => {
      root.render(<AppLike controller={controller} activeChat={chatA} selectedChatId="a" onApi={(v) => { api = v }} />)
    })
    await flushFrames()
    expect(api.visibleKey).toBe('a')
    expect(api.switching).toBe(false)
  })
})
