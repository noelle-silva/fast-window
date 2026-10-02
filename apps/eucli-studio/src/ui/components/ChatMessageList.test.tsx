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
    const message = {
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
})
