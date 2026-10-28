// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useFavoriteFolders } from './useFavoriteFolders'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const roles = [{ id: 'role-a', name: '角色A' }]
const groups = [{ id: 'group-a', name: '群聊A' }]
const workspaces = [{ id: 'ws-1', name: '工作区一' }]

function createController() {
  return {
    actions: {
      setActiveWorkspace: vi.fn(),
      setWorkspaceRole: vi.fn(),
      setActiveRole: vi.fn(),
      setActiveGroup: vi.fn(),
    },
    getSnapshot: () => 0,
    subscribe: () => () => {},
  }
}

function createDeps(controller: any) {
  return {
    controller,
    data: { favorites: { folders: [], chatRefsByFolderId: {} } },
    roles,
    groups,
    workspaces,
    clearChatSessionRunNotice: vi.fn(),
    requestSwitch: vi.fn(),
    closeChatPicker: vi.fn(),
    chatSessionRunIndicatorKind: () => '' as const,
    activeTargetKind: 'role' as const,
    activeChatTargetId: '',
    activeChatId: '',
  }
}

function Harness(props: { deps: any; apiRef: React.MutableRefObject<any> }) {
  props.apiRef.current = useFavoriteFolders(props.deps)
  return null
}

describe('收藏夹打开会话', () => {
  let host: HTMLDivElement | null = null
  let root: any = null
  let apiRef: React.MutableRefObject<any> = { current: null }

  beforeEach(() => {
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

  it('跨工作区打开收藏会话时先激活目标工作区，再解析目标角色', () => {
    const controller = createController()
    const deps = createDeps(controller)
    act(() => {
      root.render(<Harness deps={deps} apiRef={apiRef} />)
    })

    act(() => apiRef.current.openFavoritedChat('workspace', 'ws-1', 'role-a', 'session-w1'))

    expect(controller.actions.setActiveWorkspace).toHaveBeenCalledWith('ws-1')
    expect(controller.actions.setWorkspaceRole).toHaveBeenCalledWith('role-a')
    expect(controller.actions.setActiveWorkspace.mock.invocationCallOrder[0]).toBeLessThan(
      controller.actions.setWorkspaceRole.mock.invocationCallOrder[0],
    )
    expect(deps.requestSwitch).toHaveBeenCalledWith('session-w1', { force: true })
  })
})
