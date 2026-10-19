// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
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

describe('工作区导航记忆还原', () => {
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

  it('切换工作区时按该工作区记住的角色还原，而不是沿用当前角色', () => {
    rememberWorkspaceRole('ws-1', 'role-b')
    rememberWorkspaceSession('ws-1', 'role-b', 'session-b1')
    const controller = createController()
    const requestSwitch = vi.fn()
    renderHook({
      controller,
      data: { roles, workspaces },
      sidebarVisible: false,
      activeTargetKind: 'workspace',
      activeRole: { id: 'role-a' },
      activeWorkspaceId: 'ws-2',
      roles,
      workspaces,
      selectedActiveChatId: '',
      activeChatTargetId: '',
      pendingRoleChat: null,
      pendingWorkspaceChat: null,
      requestSwitch,
      clearChatSessionRunNotice: vi.fn(),
    })

    act(() => apiRef.current.selectWorkspace('ws-1'))

    expect(controller.actions.setActiveWorkspace).toHaveBeenCalledWith('ws-1')
    expect(controller.actions.setWorkspaceRole).toHaveBeenCalledWith('role-b')
    expect(requestSwitch).toHaveBeenCalledWith('session-b1', { force: true })
  })

  it('还原工作区模式时按记忆的工作区、角色与会话组合恢复', () => {
    rememberWorkspaceId('ws-1')
    rememberWorkspaceRole('ws-1', 'role-b')
    rememberWorkspaceSession('ws-1', 'role-b', 'session-b1')
    const controller = createController()
    const requestSwitch = vi.fn()
    renderHook({
      controller,
      data: { roles, workspaces },
      sidebarVisible: false,
      activeTargetKind: 'workspace',
      activeRole: { id: 'role-a' },
      activeWorkspaceId: 'ws-2',
      roles,
      workspaces,
      selectedActiveChatId: '',
      activeChatTargetId: '',
      pendingRoleChat: null,
      pendingWorkspaceChat: null,
      requestSwitch,
      clearChatSessionRunNotice: vi.fn(),
    })

    act(() => apiRef.current.restoreWorkspaceMode())

    expect(controller.actions.setActiveWorkspace).toHaveBeenCalledWith('ws-1')
    expect(controller.actions.setWorkspaceRole).toHaveBeenCalledWith('role-b')
    expect(requestSwitch).toHaveBeenCalledWith('session-b1', { force: true })
  })
})
