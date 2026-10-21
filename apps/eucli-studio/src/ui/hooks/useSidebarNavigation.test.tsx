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
})
