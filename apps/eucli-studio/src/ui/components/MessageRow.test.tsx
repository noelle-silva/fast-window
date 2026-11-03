// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MessageRow, type MessageRowActions, type MessageRowUiPolicy } from './MessageRow'
import { MESSAGE_ROW_ACTION_BAR_HEIGHT } from './MessageRowActionBar'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('./AssistantMessageBlocks', () => ({
  AssistantMessageBlocks: (props: any) => <div data-testid="assistant-message-blocks" data-text={props.text} />,
}))

function createController() {
  return {
    getScopeVer: () => 0,
    subscribeScope: () => () => {},
    getMessageById: () => null,
    renderAssistantInto: vi.fn(),
    fmtTime: (value: number) => `t${value}`,
  }
}

function createUiPolicy(): MessageRowUiPolicy {
  return {
    activeTargetKind: 'role',
    roles: [],
    activeRole: { id: 'role-1', name: 'AI' },
    loading: false,
    uiBusy: false,
    userMessageCollapseEnabled: false,
    userMessageCollapseLines: 4,
    reasoningDisplayMode: 'collapse-when-done',
    reasoningRenderEnabled: false,
    stickersEnabled: false,
    stickerMap: {},
    renderSafetyPolicyKey: 'original',
    formatModelRefText: () => '',
  }
}

function createActions(): MessageRowActions {
  return {
    messageMutationBlocked: () => false,
    onMessageContextMenu: vi.fn(),
    onToggleToolMessage: vi.fn(),
    onToggleUserMessage: vi.fn(),
    onEditTextChange: vi.fn(),
    onCancelEditMessage: vi.fn(),
    onSaveEditMessage: vi.fn(),
    onStartEditMessage: vi.fn(),
    onCopyMessageText: vi.fn(),
    onSwitchBranchSibling: vi.fn(),
    onRegenerate: vi.fn(),
    onDeleteMessage: vi.fn(),
  }
}

function userMessage(overrides: any = {}) {
  return { id: 'u-1', role: 'user', type: 'user', content: '你好', createdAt: 1000, updatedAt: 1000, ...overrides }
}

function assistantMessage(overrides: any = {}) {
  return { id: 'a-1', role: 'assistant', type: 'assistant', content: '回复', createdAt: 2000, updatedAt: 2000, ...overrides }
}

function createRowProps(overrides: any = {}) {
  const message = overrides.message || userMessage()
  return {
    controller: createController(),
    mid: String(message.id),
    message,
    runCard: null,
    branchSiblings: [],
    branchIndex: -1,
    nextAssistantMid: '',
    isUserExpanded: false,
    isToolExpanded: false,
    isEditing: false,
    editingText: '',
    uiPolicy: createUiPolicy(),
    actions: createActions(),
    chatRootRef: { current: null },
    cacheScope: 'test',
    ...overrides,
  }
}

function fireMouseOver(element: Element) {
  act(() => {
    element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }))
  })
}

function fireMouseOut(element: Element) {
  act(() => {
    element.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }))
  })
}

describe('MessageRow 操作按钮按需渲染', () => {
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

  function renderRow(overrides: any = {}) {
    const props = createRowProps(overrides)
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => {
      root.render(<MessageRow {...props} />)
    })
    const row = host.querySelector(`[data-mid="${props.mid}"]`)
    const bar = host.querySelector('[data-fw-message-actions]')
    return { props, row: row as HTMLElement, bar: bar as HTMLElement | null }
  }

  it('初始渲染不创建任何操作按钮，但时间文字与操作栏仍然存在', () => {
    const user = renderRow()
    expect(user.bar).not.toBeNull()
    expect(user.bar?.getAttribute('data-fw-message-actions')).toBe('hidden')
    expect(user.bar?.textContent).toContain('t1000')
    expect(host!.querySelector('button[aria-label="复制内容"]')).toBeNull()
    expect(host!.querySelector('button[aria-label="编辑消息"]')).toBeNull()
    expect(host!.querySelector('button[aria-label="重新回复"]')).toBeNull()
    act(() => root.unmount())
    root = null
    host!.remove()

    const assistant = renderRow({ mid: 'a-1', message: assistantMessage() })
    expect(assistant.bar).not.toBeNull()
    expect(assistant.bar?.textContent).toContain('t2000')
    expect(host!.querySelectorAll('[data-fw-message-actions] button').length).toBe(0)
    expect(host!.querySelector('button[aria-label="删除消息"]')).toBeNull()
  })

  it('鼠标移入整行后按钮出现，移出后按钮消失', () => {
    const { row } = renderRow()
    expect(row).not.toBeNull()

    fireMouseOver(row)
    expect(host!.querySelector('[data-fw-message-actions]')?.getAttribute('data-fw-message-actions')).toBe('revealed')
    expect(host!.querySelector('button[aria-label="复制内容"]')).not.toBeNull()
    expect(host!.querySelector('button[aria-label="编辑消息"]')).not.toBeNull()
    expect(host!.querySelector('button[aria-label="重新回复"]')).not.toBeNull()

    fireMouseOut(row)
    expect(host!.querySelector('[data-fw-message-actions]')?.getAttribute('data-fw-message-actions')).toBe('hidden')
    expect(host!.querySelector('button[aria-label="复制内容"]')).toBeNull()
  })

  it('键盘聚焦行容器后按钮出现，焦点离开行后按钮消失', () => {
    const { row } = renderRow()
    expect(row.getAttribute('tabindex')).toBe('0')

    act(() => row.focus())
    expect(document.activeElement).toBe(row)
    expect(host!.querySelector('button[aria-label="复制内容"]')).not.toBeNull()

    const copyButton = host!.querySelector('button[aria-label="复制内容"]') as HTMLButtonElement
    act(() => copyButton.focus())
    expect(document.activeElement).toBe(copyButton)
    expect(host!.querySelector('button[aria-label="复制内容"]')).not.toBeNull()

    const outside = document.createElement('button')
    document.body.appendChild(outside)
    act(() => outside.focus())
    expect(host!.querySelector('button[aria-label="复制内容"]')).toBeNull()
    outside.remove()
  })

  it('按需渲染后各操作回调仍能正确触发', () => {
    const { row, props } = renderRow({ nextAssistantMid: 'a-1' })
    fireMouseOver(row)

    act(() => (host!.querySelector('button[aria-label="复制内容"]') as HTMLButtonElement).click())
    expect(props.actions.onCopyMessageText).toHaveBeenCalledWith('你好')

    act(() => (host!.querySelector('button[aria-label="编辑消息"]') as HTMLButtonElement).click())
    expect(props.actions.onStartEditMessage).toHaveBeenCalledWith('u-1', '你好')

    act(() => (host!.querySelector('button[aria-label="重新回复"]') as HTMLButtonElement).click())
    expect(props.actions.onRegenerate).toHaveBeenCalledWith('a-1', 'assistant')
  })

  it('AI 消息的分支切换与删除回调仍能正确触发', () => {
    const { row, props } = renderRow({
      mid: 'a-1',
      message: assistantMessage(),
      branchSiblings: [{ id: 'a-1' }, { id: 'a-2' }],
      branchIndex: 0,
    })
    fireMouseOver(row)

    act(() => (host!.querySelector('button[aria-label="下一个分支"]') as HTMLButtonElement).click())
    expect(props.actions.onSwitchBranchSibling).toHaveBeenCalledWith('a-1', 1, 'a-2')

    act(() => (host!.querySelector('button[aria-label="删除消息"]') as HTMLButtonElement).click())
    expect(props.actions.onDeleteMessage).toHaveBeenCalledWith('a-1', 'assistant')
  })

  it('显示/隐藏按钮不改变操作栏的固定高度', () => {
    const { row, bar } = renderRow()
    expect(bar?.style.height).toBe(`${MESSAGE_ROW_ACTION_BAR_HEIGHT}px`)

    fireMouseOver(row)
    expect((host!.querySelector('[data-fw-message-actions]') as HTMLElement).style.height).toBe(`${MESSAGE_ROW_ACTION_BAR_HEIGHT}px`)

    fireMouseOut(row)
    expect((host!.querySelector('[data-fw-message-actions]') as HTMLElement).style.height).toBe(`${MESSAGE_ROW_ACTION_BAR_HEIGHT}px`)
  })

  it('编辑态保持原样：显示编辑框与保存/取消，不渲染悬停操作栏', () => {
    const { row, props } = renderRow({ isEditing: true, editingText: '修改中' })
    expect(row.getAttribute('tabindex')).toBeNull()
    expect((host!.querySelector('textarea') as HTMLTextAreaElement)?.value).toBe('修改中')
    expect(host!.querySelector('[data-fw-message-actions]')).toBeNull()

    const buttons = Array.from(host!.querySelectorAll('button')).map((node) => node.textContent)
    expect(buttons).toEqual(expect.arrayContaining(['保存', '取消']))

    const save = Array.from(host!.querySelectorAll('button')).find((node) => node.textContent === '保存') as HTMLButtonElement
    act(() => save.click())
    expect(props.actions.onSaveEditMessage).toHaveBeenCalled()

    const cancel = Array.from(host!.querySelectorAll('button')).find((node) => node.textContent === '取消') as HTMLButtonElement
    act(() => cancel.click())
    expect(props.actions.onCancelEditMessage).toHaveBeenCalled()
  })

  it('待运行尾部占位保持原样：没有操作栏且不可聚焦', () => {
    const { row } = renderRow({
      mid: 'tail-1',
      message: assistantMessage({ id: 'tail-1', displayOnlyPendingRunTail: true }),
    })
    expect(row.getAttribute('tabindex')).toBeNull()
    expect(host!.querySelector('[data-fw-message-actions]')).toBeNull()

    fireMouseOver(row)
    expect(host!.querySelector('[data-fw-message-actions]')).toBeNull()
    expect(host!.querySelectorAll('button').length).toBe(0)
  })

  it('工具返回行保持原样：没有操作栏，展开回调仍可用', () => {
    const content = '<<<[TOOL_RESPONSE]>>>\n<<[RESULT-1]>>\ntool_name:「start」read「end」'
    const { props } = renderRow({ message: userMessage({ content }) })
    expect(host!.querySelector('[data-fw-message-actions]')).toBeNull()
    expect(host!.querySelector('[aria-label="展开工具返回"]')).not.toBeNull()

    act(() => (host!.querySelector('[aria-label="展开工具返回"]') as HTMLElement).click())
    expect(props.actions.onToggleToolMessage).toHaveBeenCalledWith('u-1')
  })
})
