// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getSidebarNavigationMemory,
  rememberWorkspaceId,
  rememberWorkspaceRole,
  rememberWorkspaceSession,
  resetSidebarNavigationMemory,
} from '../../domain/sidebarNavigationMemory'
import { useSidebarNavigation } from './useSidebarNavigation'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const roles = [
  { id: 'role-a', name: '角色A' },
  { id: 'role-b', name: '角色B' },
]

const workspaces = [
  { id: 'ws-1', name: '工作区一' },
  { id: 'ws-2', name: '工作区二' },
]

function createController() {
  return {
    actions: {
      setActiveWorkspace: vi.fn(),
      setWorkspaceRole: vi.fn(),
      setActiveRole: vi.fn(),
    },
  }
}

function Harness(props: { input: any; apiRef: React.MutableRefObject<any> }) {
  props.apiRef.current = useSidebarNavigation(props.input)
  return null
}

describe('侧边栏导航', () => {
  let host: HTMLDivElement | null = null
  let root: any = null
  let apiRef: React.MutableRefObject<any> = { current: null }

  beforeEach(() => {
    resetSidebarNavigationMemory()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    apiRef = { current: null }
  })

  afterEach(() => {
    if (root) {
      act(() => root.unmount())
      root = null
    }
    host?.remove()
    host = null
  })

  function renderHook(input: any) {
    act(() => {
      root.render(<Harness input={input} apiRef={apiRef} />)
    })
  }

  function baseInput(overrides: any) {
    return {
      controller: createController(),
      data: { roles, workspaces },
      sidebarVisible: false,
      activeTargetKind: 'role',
      activeRole: { id: 'role-a' },
      activeWorkspaceId: '',
      roles,
      workspaces,
      selectedActiveChatId: '',
      pendingRoleChat: null,
      pendingWorkspaceChat: null,
      requestSwitch: vi.fn(),
      clearChatSessionRunNotice: vi.fn(),
      ...overrides,
    }
  }

  it('切换工作区时按该工作区记住的角色还原，而不是沿用当前角色', () => {
    rememberWorkspaceRole('ws-1', 'role-b')
    rememberWorkspaceSession('ws-1', 'role-b', 'session-b1')
    const controller = createController()
    const requestSwitch = vi.fn()
    renderHook(baseInput({
      controller,
      activeTargetKind: 'workspace',
      activeWorkspaceId: 'ws-2',
      requestSwitch,
    }))

    act(() => apiRef.current.selectWorkspace('ws-1'))

    expect(controller.actions.setActiveWorkspace).toHaveBeenCalledWith('ws-1')
    expect(controller.actions.setWorkspaceRole).toHaveBeenCalledWith('role-b')
    expect(requestSwitch).toHaveBeenCalledWith('session-b1', { force: true })
  })

  it('进入侧边栏时按记忆的工作区、角色与会话组合恢复', () => {
    rememberWorkspaceId('ws-1')
    rememberWorkspaceRole('ws-1', 'role-b')
    rememberWorkspaceSession('ws-1', 'role-b', 'session-b1')
    const controller = createController()
    const requestSwitch = vi.fn()
    renderHook(baseInput({
      controller,
      sidebarVisible: true,
      activeTargetKind: 'workspace',
      activeWorkspaceId: 'ws-2',
      requestSwitch,
    }))

    expect(controller.actions.setActiveWorkspace).toHaveBeenCalledWith('ws-1')
    expect(controller.actions.setWorkspaceRole).toHaveBeenCalledWith('role-b')
    expect(requestSwitch).toHaveBeenCalledWith('session-b1', { force: true })
  })

  it('切换侧边栏视图只改变侧边栏显示，不改变聊天目标', () => {
    const controller = createController()
    renderHook(baseInput({ controller }))

    expect(apiRef.current.view).toBe('role')

    act(() => apiRef.current.toggleView())

    expect(apiRef.current.view).toBe('workspace')
    expect(controller.actions.setActiveRole).not.toHaveBeenCalled()
    expect(controller.actions.setActiveWorkspace).not.toHaveBeenCalled()
  })

  it('工作区视图点击会话时先切到工作区目标，再切换会话', () => {
    const controller = createController()
    const requestSwitch = vi.fn()
    const clearChatSessionRunNotice = vi.fn()
    renderHook(baseInput({
      controller,
      activeTargetKind: 'role',
      activeWorkspaceId: 'ws-1',
      requestSwitch,
      clearChatSessionRunNotice,
    }))

    act(() => apiRef.current.toggleView())
    act(() => apiRef.current.selectSession('session-w1'))

    expect(controller.actions.setActiveWorkspace).toHaveBeenCalledWith('ws-1')
    expect(clearChatSessionRunNotice).toHaveBeenCalledWith('workspace', 'ws-1::role-a', 'session-w1')
    expect(requestSwitch).toHaveBeenCalledWith('session-w1', { force: true })
    expect(getSidebarNavigationMemory().workspace.sessionByWorkspaceRole['ws-1::role-a']).toBe('session-w1')
  })

  it('角色视图点击会话时先切到角色目标，再切换会话', () => {
    const controller = createController()
    const requestSwitch = vi.fn()
    renderHook(baseInput({
      controller,
      activeTargetKind: 'workspace',
      activeWorkspaceId: 'ws-1',
      requestSwitch,
    }))

    act(() => apiRef.current.toggleView())
    act(() => apiRef.current.selectSession('session-r1'))

    expect(controller.actions.setActiveRole).toHaveBeenCalledWith('role-a')
    expect(requestSwitch).toHaveBeenCalledWith('session-r1', { force: true })
    expect(getSidebarNavigationMemory().role.sessionByRole['role-a']).toBe('session-r1')
  })

  // 回归：新建会话发送后，pending 落地的一瞬间列表仍是上一轮会话。
  // 此时绝不能因为 remembered(draft id) 不在列表里，就把用户刚选中的新会话
  // 强制切回列表头（上一轮会话）。
  it('pending 会话落地且列表尚未追上时，不做回退切换', () => {
    const requestSwitch = vi.fn()
    const data = {
      roles,
      workspaces,
      chatsByRole: {
        'role-a': {
          activeChatId: 'session-old',
          chatMetas: [{ id: 'session-old', updatedAt: 1 }],
          chats: [],
        },
      },
    }
    renderHook(baseInput({
      data,
      sidebarVisible: true,
      pendingRoleChat: { roleId: 'role-a', chat: { id: 'draft-1' } },
      selectedActiveChatId: 'draft-1',
      requestSwitch,
    }))
    expect(getSidebarNavigationMemory().role.sessionByRole['role-a']).toBe('draft-1')
    requestSwitch.mockClear()

    renderHook(baseInput({
      data,
      sidebarVisible: true,
      pendingRoleChat: null,
      selectedActiveChatId: 'session-new',
      requestSwitch,
    }))

    expect(requestSwitch).not.toHaveBeenCalled()
    expect(getSidebarNavigationMemory().role.sessionByRole['role-a']).toBe('session-new')
  })

  it('工作区 pending 会话落地且列表尚未追上时，不做回退切换', () => {
    const requestSwitch = vi.fn()
    const data = {
      roles,
      workspaces,
      chatsByWorkspace: {
        'ws-1::role-a': {
          activeChatId: 'session-old',
          chatMetas: [{ id: 'session-old', updatedAt: 1 }],
          chats: [],
        },
      },
    }
    renderHook(baseInput({
      data,
      sidebarVisible: true,
      activeTargetKind: 'workspace',
      activeWorkspaceId: 'ws-1',
      pendingWorkspaceChat: { workspaceId: 'ws-1', roleId: 'role-a', chat: { id: 'draft-w' } },
      selectedActiveChatId: 'draft-w',
      requestSwitch,
    }))
    expect(getSidebarNavigationMemory().workspace.sessionByWorkspaceRole['ws-1::role-a']).toBe('draft-w')
    requestSwitch.mockClear()

    renderHook(baseInput({
      data,
      sidebarVisible: true,
      activeTargetKind: 'workspace',
      activeWorkspaceId: 'ws-1',
      pendingWorkspaceChat: null,
      selectedActiveChatId: 'session-new',
      requestSwitch,
    }))

    expect(requestSwitch).not.toHaveBeenCalled()
    expect(getSidebarNavigationMemory().workspace.sessionByWorkspaceRole['ws-1::role-a']).toBe('session-new')
  })

  it('角色视图点击与当前同名的角色时仍进入工作区目标', () => {
    const controller = createController()
    renderHook(baseInput({
      controller,
      activeTargetKind: 'role',
      activeRole: { id: 'role-a' },
      activeWorkspaceId: 'ws-1',
      workspaces: [{ id: 'ws-1', name: '工作区一', registeredRoleIds: ['role-a'] }],
    }))

    act(() => apiRef.current.selectWorkspaceRole('role-a'))

    expect(controller.actions.setWorkspaceRole).toHaveBeenCalledWith('role-a')
  })
})
