// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReasoningDisplayMode } from '../../domain/reasoningDisplay'
import { ChatMessageList } from './ChatMessageList'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('./AssistantMessageBlocks', () => ({
  AssistantMessageBlocks: (props: any) => <div data-testid="assistant-message-blocks" data-text={props.text} />,
}))

function createProps(controller: any, message: any) {
  const noop = vi.fn()
  return {
    controller,
    messages: [message],
    roles: [],
    activeRole: { id: 'role-1', name: 'AI' },
    activeTargetKind: 'role' as const,
    activeVisibleRunCards: [
      {
        kind: 'eb-role-run',
        runId: 'run-1',
        roleId: 'role-1',
        groupId: '',
        workspaceId: '',
        sessionId: 'session-1',
        inputMessageId: 'user-1',
        lastMessageId: 'message-1',
        anchorMessageId: 'user-1',
        dependencyMessageIds: [],
        status: 'running',
        stream: true,
        retry: null,
        cancelledByUser: false,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    prevAiMidByAssistantId: new Map<string, string>(),
    assistantSiblingsByPrevAiMid: new Map<string, any[]>(),
    chatAllMessagesRaw: [message],
    expandedToolMsgIds: new Set<string>(),
    expandedUserMsgIds: new Set<string>(),
    editingMsg: { mid: '', text: '' },
    loading: false,
    uiBusy: false,
    userMessageCollapseEnabled: false,
    userMessageCollapseLines: 4,
    reasoningDisplayMode: 'collapse-when-done' as ReasoningDisplayMode,
    reasoningRenderEnabled: false,
    workProcessDisplayEnabled: false,
    workProcessDisplayMode: 'collapse-when-done' as const,
    workProcessInnerScrollEnabled: false,
    workProcessInnerScrollHeight: 480,
    workProcessInnerScrollWidth: 80,
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

describe('ChatMessageList streaming body mounting', () => {
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

  it('keeps the scoped body mounted when the first snapshot has only reasoning metadata', () => {
    const message: any = {
      id: 'message-1',
      role: 'assistant',
      type: 'assistant',
      content: '',
      parts: [{ id: 'reasoning-1', type: 'reasoning', text: '', signature: 'encrypted-signature' }],
      createdAt: 1,
      updatedAt: 1,
      pending: true,
      streaming: true,
      assistantRun: {
        generationId: 'run-1',
        status: 'running',
        mode: 'new',
        stream: true,
        startedAt: 1,
        updatedAt: 1,
      },
    }
    let scopeVersion = 0
    let notifyScope: (() => void) | null = null
    const subscribeScope = vi.fn((_scope: string, listener: () => void) => {
      notifyScope = listener
      return () => {}
    })
    const controller = {
      getScopeVer: () => scopeVersion,
      subscribeScope,
      getMessageById: () => message,
      renderAssistantInto: vi.fn(),
      fmtTime: () => '',
    }

    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => {
      root.render(<ChatMessageList {...createProps(controller, message)} />)
    })

    expect(host.querySelector('[data-testid="assistant-message-blocks"]')).not.toBeNull()
    expect(host.querySelector('[role="status"][aria-label="AI 回复加载中"]')).not.toBeNull()
    expect(subscribeScope).toHaveBeenCalledWith('message:message-1', expect.any(Function))

    message.content = '后续正文'
    message.parts = [{ id: 'text-1', type: 'text', text: '后续正文' }]
    scopeVersion = 1
    act(() => notifyScope?.())

    expect(host.querySelector('[role="status"][aria-label="AI 回复加载中"]')).toBeNull()
    expect(host.querySelector('[data-testid="assistant-message-blocks"]')?.getAttribute('data-text')).toBe('后续正文')
  })

  it('renders old batches above the visible tail and hides the staging batch', () => {
    const controller = {
      getScopeVer: () => 0,
      subscribeScope: () => () => {},
      getMessageById: () => null,
      renderAssistantInto: vi.fn(),
      fmtTime: () => '',
    }
    const makeMessage = (id: string) => ({ id, role: 'user', type: 'user', content: id, createdAt: 1, updatedAt: 1 })
    const tail = makeMessage('m-3')
    const props: any = createProps(controller, tail)
    props.messages = [tail]
    props.messageBatchGroups = [
      { key: 'batch-1', messages: [makeMessage('m-0'), makeMessage('m-1')], revealed: true },
      { key: 'batch-2', messages: [makeMessage('m-2')], revealed: false },
    ]

    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => {
      root.render(<ChatMessageList {...props} />)
    })

    expect(Array.from(host.querySelectorAll('[data-mid]')).map((node) => node.getAttribute('data-mid')).sort()).toEqual([
      'm-0',
      'm-1',
      'm-2',
      'm-3',
    ])
    // 已揭示批次直接并入时间线（不再有独立容器），只有缓存批次保留屏外暂存容器。
    const staging = host.querySelectorAll('[data-fw-message-batch]')
    expect(staging.length).toBe(1)
    expect(staging[0].getAttribute('data-fw-message-batch')).toBe('staging')
    expect(staging[0].getAttribute('aria-hidden')).toBe('true')
  })

  // 回归：区间识别必须覆盖「已揭示批次 + 尾部」这条完整时间线。
  // 只按尾部算会把更早的工具过程整段漏掉，并把跨批次的区间截短。
  it('工作过程区间跨已揭示批次与尾部仍完整', () => {
    const controller = {
      getScopeVer: () => 0,
      subscribeScope: () => () => {},
      getMessageById: () => null,
      renderAssistantInto: vi.fn(),
      fmtTime: () => '',
    }
    const makeMessage = (id: string, role: 'user' | 'assistant', tools = 0) => ({
      id,
      role,
      type: role,
      content: id,
      parts: Array.from({ length: tools }, (_, index) => ({ id: `${id}-tool-${index}`, type: 'tool' })),
      createdAt: 1,
      updatedAt: 1,
    })
    const user = makeMessage('m-0', 'user')
    const toolFirst = makeMessage('m-1', 'assistant', 1)
    const toolSecond = makeMessage('m-2', 'assistant', 1)
    const answer = makeMessage('m-3', 'assistant', 0)

    const props: any = createProps(controller, answer)
    props.messages = [answer]
    props.messageBatchGroups = [
      { key: 'batch-1', messages: [user, toolFirst], revealed: true },
      { key: 'batch-2', messages: [toolSecond], revealed: true },
    ]
    props.workProcessDisplayEnabled = true
    props.workProcessDisplayMode = 'stay-expanded'

    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => {
      root.render(<ChatMessageList {...props} />)
    })

    const startBar = host.querySelector('[data-tool-process-divider="start"]') as HTMLElement | null
    const endBar = host.querySelector('[data-tool-process-divider="end"]') as HTMLElement | null
    expect(startBar).not.toBeNull()
    expect(endBar).not.toBeNull()
    expect(startBar!.textContent).toContain('2 轮')
    expect(startBar!.textContent).toContain('2 次工具调用')

    // 区间面板里应当同时装下批次里的 m-1 与尾部的 m-2。
    const panel = startBar!.parentElement as HTMLElement
    const inside = Array.from(panel.querySelectorAll('[data-mid]')).map((node) => node.getAttribute('data-mid'))
    expect(inside).toContain('m-1')
    expect(inside).toContain('m-2')
  })

  it('pins generating messages and the pending run tail against offscreen skipping', () => {
    const controller = {
      getScopeVer: () => 0,
      subscribeScope: () => () => {},
      getMessageById: () => null,
      renderAssistantInto: vi.fn(),
      fmtTime: () => '',
    }
    const generating: any = {
      id: 'message-1',
      role: 'assistant',
      type: 'assistant',
      content: '生成中',
      createdAt: 1,
      updatedAt: 1,
      pending: true,
      streaming: true,
      assistantRun: {
        generationId: 'run-1',
        status: 'running',
        mode: 'new',
        stream: true,
        startedAt: 1,
        updatedAt: 1,
      },
    }
    const offscreen = {
      attach: vi.fn(),
      update: vi.fn(),
      detach: vi.fn(),
      revealAround: vi.fn(),
    }
    const props: any = createProps(controller, generating)
    props.messageOffscreen = offscreen
    props.messages = [generating]

    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => {
      root.render(<ChatMessageList {...props} />)
    })

    expect(host.querySelector('[data-fw-message-slot="message-1"]')).not.toBeNull()
    expect(offscreen.attach.mock.calls[0]?.[0]).toBe('message-1')
    expect(offscreen.attach.mock.calls[0]?.[2]?.pinned).toBe(true)

    const tail: any = {
      id: '__ui_active_run_tail_pending:run-1',
      role: 'assistant',
      type: 'assistant',
      content: '生成中',
      createdAt: 1,
      updatedAt: 1,
      pending: true,
      displayOnlyPendingRunTail: true,
      assistantRun: {
        generationId: 'run-1',
        status: 'running',
        mode: 'new',
        stream: true,
        startedAt: 1,
        updatedAt: 1,
      },
    }
    props.messages = [tail]
    props.activeVisibleRunCards = []
    act(() => {
      root.render(<ChatMessageList {...props} />)
    })

    expect(offscreen.attach.mock.calls.at(-1)?.[0]).toBe('__ui_active_run_tail_pending:run-1')
    expect(offscreen.attach.mock.calls.at(-1)?.[2]?.pinned).toBe(true)
  })
})
