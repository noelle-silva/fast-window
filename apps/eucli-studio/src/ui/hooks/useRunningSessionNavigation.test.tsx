// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RunningSessionEntry } from '../../domain/runningSessions'
import { useRunningSessionNavigation } from './useRunningSessionNavigation'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

function entry(patch: Partial<RunningSessionEntry> = {}): RunningSessionEntry {
  return {
    key: 'role:role-a:session-1',
    targetKind: 'role',
    targetId: 'role-a',
    roleId: 'role-a',
    groupId: '',
    workspaceId: '',
    sessionId: 'session-1',
    title: '会话',
    targetName: '角色A',
    avatarImage: '',
    statusKey: 'running',
    statusLabel: '生成中',
    updatedAt: 100,
    ...patch,
  }
}

function createController() {
  return {
    actions: {
      setActiveRole: vi.fn(),
      setActiveGroup: vi.fn(),
      setActiveWorkspace: vi.fn(),
      setWorkspaceRole: vi.fn(),
    },
  }
}

function Harness(props: { controller: any; requestSwitch: any; apiRef: React.MutableRefObject<any> }) {
  props.apiRef.current = useRunningSessionNavigation({
    controller: props.controller,
    requestSwitch: props.requestSwitch,
  })
  return null
}

describe('运行中会话跳转', () => {
  let host: HTMLDivElement | null = null
  let root: any = null
  let apiRef: React.MutableRefObject<any> = { current: null }

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    apiRef = { current: null }
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

  it('角色会话切换角色后打开对应会话', async () => {
    const controller = createController()
    const requestSwitch = vi.fn()
    await act(async () => {
      root.render(React.createElement(Harness, { controller, requestSwitch, apiRef }))
    })

    await act(async () => {
      apiRef.current(entry())
    })

    expect(controller.actions.setActiveRole).toHaveBeenCalledWith('role-a')
    expect(requestSwitch).toHaveBeenCalledWith('session-1', { force: true })
  })

  it('群组会话切换群组后打开对应会话', async () => {
    const controller = createController()
    const requestSwitch = vi.fn()
    await act(async () => {
      root.render(React.createElement(Harness, { controller, requestSwitch, apiRef }))
    })

    await act(async () => {
      apiRef.current(entry({ targetKind: 'group', targetId: 'group-a', groupId: 'group-a' }))
    })

    expect(controller.actions.setActiveGroup).toHaveBeenCalledWith('group-a')
    expect(requestSwitch).toHaveBeenCalledWith('session-1', { force: true })
  })

  it('工作区会话先切工作区与角色，再打开对应会话', async () => {
    const controller = createController()
    const requestSwitch = vi.fn()
    await act(async () => {
      root.render(React.createElement(Harness, { controller, requestSwitch, apiRef }))
    })

    await act(async () => {
      apiRef.current(entry({ targetKind: 'workspace', targetId: 'workspace-a::role-a', workspaceId: 'workspace-a' }))
    })

    expect(controller.actions.setActiveWorkspace).toHaveBeenCalledWith('workspace-a')
    expect(controller.actions.setWorkspaceRole).toHaveBeenCalledWith('role-a')
    expect(requestSwitch).toHaveBeenCalledWith('session-1', { force: true })
    expect(controller.actions.setActiveWorkspace.mock.invocationCallOrder[0]).toBeLessThan(
      requestSwitch.mock.invocationCallOrder[0],
    )
  })
})
