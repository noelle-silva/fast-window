// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useChatTree } from './useChatTree'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

// 分支树上的节点点击只是视窗偏好：
// 它可以改变「当前看哪条路径」，但绝不能改写活动分支 / 分支头等会话事实。

function makeChat() {
  return {
    id: 'chat-1',
    updatedAt: 1,
    branching: {
      schemaVersion: 1,
      activeBranchId: 'main',
      branches: [
        { id: 'main', name: '主线', headMid: 'a2', createdAt: 1, updatedAt: 1 },
        { id: 'alt', name: '分支 1', headMid: 'a2b', createdAt: 2, updatedAt: 2 },
      ],
    },
    messages: [
      { id: 'u1', role: 'user', parentMid: '', branchId: 'main', createdAt: 1, updatedAt: 1 },
      { id: 'a1', role: 'assistant', parentMid: 'u1', branchId: 'main', createdAt: 2, updatedAt: 2 },
      { id: 'u2', role: 'user', parentMid: 'a1', branchId: 'main', createdAt: 3, updatedAt: 3 },
      { id: 'a2', role: 'assistant', parentMid: 'u2', branchId: 'main', createdAt: 4, updatedAt: 4 },
      { id: 'a2b', role: 'assistant', parentMid: 'u2', branchId: 'alt', createdAt: 5, updatedAt: 5 },
    ],
  }
}

function renderTreeHook(chat: any) {
  const setActiveBranch = vi.fn()
  const setViewIntentFromNodeClick = vi.fn()
  const setBranchNav = vi.fn()
  const byId = new Map<string, any>(chat.messages.map((m: any) => [String(m.id), m] as [string, any]))
  let api: any = null

  function Harness() {
    api = useChatTree({
      controller: { actions: { setActiveBranch, loadSessionGraph: vi.fn() } },
      data: { settings: {} },
      activeChat: chat,
      renderChat: chat,
      renderChatId: chat.id,
      page: 'chat',
      composerInputRef: { current: null },
      chatPaneRef: { current: null },
      chatAllById: byId,
      chatAllMessagesRaw: chat.messages,
      activeSessionRunCards: [],
      activeSessionRunCardsKey: '',
      viewFocusMid: 'a2',
      setViewIntentFromNodeClick,
      branchDraft: null,
      branchDraftKey: '',
      pauseFollow: () => {},
      autoScrollBlockUntilRef: { current: 0 },
      setBranchNav,
      treeSuppressClickRef: { current: false },
      getLastMsgId: () => 'a2',
    })
    return null
  }

  const host = document.createElement('div')
  let root: Root | null = createRoot(host)
  act(() => root!.render(React.createElement(Harness)))
  return {
    setActiveBranch,
    setViewIntentFromNodeClick,
    setBranchNav,
    api: () => api,
    unmount: () => {
      act(() => root!.unmount())
      root = null
    },
  }
}

let active: ReturnType<typeof renderTreeHook> | null = null

afterEach(() => {
  active?.unmount()
  active = null
})

describe('分支树节点点击只改视窗偏好', () => {
  it('点击其它分支节点不改活动分支 / 分支头', () => {
    const chat = makeChat()
    const before = JSON.stringify(chat.branching)
    active = renderTreeHook(chat)

    act(() => active!.api().jumpToMessage('a2b'))

    expect(active.setViewIntentFromNodeClick).toHaveBeenCalledWith('a2b')
    expect(active.setBranchNav).toHaveBeenCalled()
    expect(active.setActiveBranch).not.toHaveBeenCalled()
    expect(JSON.stringify(chat.branching)).toBe(before)
  })

  it('点击不存在的节点不产生任何选择动作', () => {
    const chat = makeChat()
    active = renderTreeHook(chat)

    act(() => active!.api().jumpToMessage('missing'))

    expect(active.setViewIntentFromNodeClick).not.toHaveBeenCalled()
    expect(active.setBranchNav).not.toHaveBeenCalled()
  })
})
