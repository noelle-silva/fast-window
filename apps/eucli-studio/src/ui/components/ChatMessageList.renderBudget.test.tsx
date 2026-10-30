// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReasoningDisplayMode } from '../../domain/reasoningDisplay'
import { ChatMessageList } from './ChatMessageList'
import { MessageRow } from './MessageRow'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const rowRenders = vi.hoisted(() => ({ count: 0 }))

vi.mock('./AssistantMessageBlocks', () => ({
  AssistantMessageBlocks: (props: any) => <div data-testid="assistant-message-blocks" data-text={props.text} />,
}))

// 行级渲染计数：包一层计数组件，不改变 MessageRow 的 memo 行为。
vi.mock('./MessageRow', async () => {
  const actual = await vi.importActual<typeof import('./MessageRow')>('./MessageRow')
  const Counted = React.memo(
    (props: any) => {
      rowRenders.count += 1
      return <actual.MessageRow {...props} />
    },
    (prev: any, next: any) => (
      prev.message === next.message &&
      prev.runCard === next.runCard &&
      prev.branchSiblings === next.branchSiblings &&
      prev.branchIndex === next.branchIndex &&
      prev.nextAssistantMid === next.nextAssistantMid &&
      prev.isUserExpanded === next.isUserExpanded &&
      prev.isToolExpanded === next.isToolExpanded &&
      prev.isEditing === next.isEditing &&
      prev.editingText === next.editingText &&
      prev.uiPolicy === next.uiPolicy &&
      prev.actions === next.actions &&
      prev.cacheScope === next.cacheScope
    ),
  )
  return { ...actual, MessageRow: Counted }
})

function createProps(controller: any, messages: any[]) {
  const noop = vi.fn()
  return {
    controller,
    messages,
    roles: [],
    activeRole: { id: 'role-1', name: 'AI' },
    activeTargetKind: 'role' as const,
    activeVisibleRunCards: [],
    prevAiMidByAssistantId: new Map<string, string>(),
    assistantSiblingsByPrevAiMid: new Map<string, any[]>(),
    chatAllMessagesRaw: messages,
    expandedToolMsgIds: new Set<string>(),
    expandedUserMsgIds: new Set<string>(),
    editingMsg: { mid: '', text: '' },
    loading: false,
    uiBusy: false,
    userMessageCollapseEnabled: false,
    userMessageCollapseLines: 4,
    reasoningDisplayMode: 'collapse-when-done' as ReasoningDisplayMode,
    reasoningRenderEnabled: false,
    stickersEnabled: false,
    stickerMap: {},
    renderSafetyPolicyKey: 'original',
    chatRootRef: { current: null },
    formatModelRefText: () => '',
    messageMutationBlocked: () => false,
    onMessageContextMenu: noop,
    onToggleToolMessage: noop,
    onToggleUserMessage: noop,
    onEditTextChange: noop,
    onCancelEditMessage: noop,
    onSaveEditMessage: noop,
    onStartEditMessage: noop,
    onCopyMessageText: noop,
    onSwitchBranchSibling: noop,
    onRegenerate: noop,
    onDeleteMessage: noop,
  }
}

function makeMessages(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `m-${index}`,
    role: index % 2 === 0 ? 'user' : 'assistant',
    type: index % 2 === 0 ? 'user' : 'assistant',
    content: `内容 ${index}`,
    createdAt: index,
    updatedAt: index,
  }))
}

describe('ChatMessageList 行级渲染预算', () => {
  let host: HTMLDivElement | null = null
  let root: any = null

  afterEach(() => {
    if (root) {
      act(() => root.unmount())
      root = null
    }
    host?.remove()
    host = null
  })

  it('切到已缓存会话时，已上屏行不再重建（渲染次数为 0）', () => {
    const controller = {
      getScopeVer: () => 0,
      subscribeScope: () => () => {},
      getMessageById: () => null,
      renderAssistantInto: vi.fn(),
      fmtTime: () => '',
    }
    const messages = makeMessages(6)
    const props: any = createProps(controller, messages)

    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    rowRenders.count = 0
    act(() => {
      root.render(<ChatMessageList {...props} />)
    })
    const firstRenderCount = rowRenders.count
    expect(firstRenderCount).toBe(6)

    // 模拟「切到已缓存会话」：数据引用与 uiPolicy 输入全部不变，
    // 只有父级因为无关的轻交互重渲染（新的 props 对象，同样的值）。
    act(() => {
      root.render(<ChatMessageList {...props} />)
    })
    expect(rowRenders.count).toBe(firstRenderCount)

    // 再叠一层父级重渲染：仍然 0 增量。
    act(() => {
      root.render(<ChatMessageList {...props} />)
    })
    expect(rowRenders.count).toBe(firstRenderCount)
  })

  it('消息对象变化时只重建那一条', () => {
    const controller = {
      getScopeVer: () => 0,
      subscribeScope: () => () => {},
      getMessageById: () => null,
      renderAssistantInto: vi.fn(),
      fmtTime: () => '',
    }
    const messages = makeMessages(6)
    const props: any = createProps(controller, messages)

    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    rowRenders.count = 0
    act(() => {
      root.render(<ChatMessageList {...props} />)
    })
    expect(rowRenders.count).toBe(6)

    const nextMessages = messages.slice()
    nextMessages[2] = { ...messages[2], content: '改过的内容' }
    rowRenders.count = 0
    act(() => {
      root.render(<ChatMessageList {...props} messages={nextMessages} />)
    })
    expect(rowRenders.count).toBe(1)
  })

  it('分支索引与用户消息重新回复目标由列表侧预建，行内不再线性扫描', () => {
    const controller = {
      getScopeVer: () => 0,
      subscribeScope: () => () => {},
      getMessageById: () => null,
      renderAssistantInto: vi.fn(),
      fmtTime: () => '',
    }

    // O(n²) 会随消息条数平方增长；行内 O(1) 时 findIndex 调用次数不随条数变化。
    const measure = (count: number) => {
      const messages = makeMessages(count)
      const props: any = createProps(controller, messages)
      const localHost = document.createElement('div')
      document.body.appendChild(localHost)
      const localRoot = createRoot(localHost)
      const spy = vi.spyOn(Array.prototype, 'findIndex')
      act(() => {
        localRoot.render(<ChatMessageList {...props} />)
      })
      const calls = spy.mock.calls.length
      spy.mockRestore()
      act(() => localRoot.unmount())
      localHost.remove()
      return calls
    }

    const small = measure(4)
    const large = measure(40)
    // 条数扩大 10 倍，findIndex 调用次数不随之增长。
    expect(large).toBeLessThanOrEqual(small + 2)
  })
})
