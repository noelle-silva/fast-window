// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RunningSessionEntry } from '../../domain/runningSessions'
import { RunningSessionsDialog } from './RunningSessionsDialog'

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
    title: '角色会话',
    targetName: '角色A',
    avatarImage: '',
    statusKey: 'running',
    statusLabel: '生成中',
    updatedAt: 100,
    ...patch,
  }
}

describe('运行中会话窗口', () => {
  let host: HTMLDivElement | null = null
  let root: any = null

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
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
    document.body.innerHTML = ''
  })

  it('一行显示一条会话，点击后回传对应条目', async () => {
    const onOpen = vi.fn()
    await act(async () => {
      root.render(
        React.createElement(RunningSessionsDialog, {
          open: true,
          entries: [entry()],
          activeKey: '',
          onClose: vi.fn(),
          onOpen,
        }),
      )
    })

    expect(document.body.textContent).toContain('正在运行的会话')
    expect(document.body.textContent).toContain('角色会话')
    expect(document.body.textContent).toContain('生成中')

    const rows = Array.from(document.querySelectorAll('[role="button"]')) as HTMLElement[]
    const row = rows.find((item) => String(item.textContent || '').includes('角色会话'))
    expect(row).toBeTruthy()

    await act(async () => {
      row!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen.mock.calls[0][0]).toMatchObject({ key: 'role:role-a:session-1', sessionId: 'session-1' })
  })

  it('没有运行中会话时显示空状态', async () => {
    await act(async () => {
      root.render(
        React.createElement(RunningSessionsDialog, {
          open: true,
          entries: [],
          activeKey: '',
          onClose: vi.fn(),
          onOpen: vi.fn(),
        }),
      )
    })

    expect(document.body.textContent).toContain('现在没有正在运行的会话。')
  })
})
