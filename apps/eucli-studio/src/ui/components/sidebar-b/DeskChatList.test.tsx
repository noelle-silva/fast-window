// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ThemeProvider } from '@mui/material'
import { getColorThemeColors, resolveColorThemePreview } from '../../../domain/colorTheme'
import type { DeskEntry } from '../../../domain/desks'
import { createStudioMuiTheme } from '../../colorThemeStyles'
import { DeskChatList } from './DeskChatList'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const noop = () => {}

function entry(overrides: Partial<DeskEntry> = {}): DeskEntry {
  return {
    targetKind: 'role',
    targetId: 'role-a',
    roleId: '',
    chatId: 'chat-1',
    addedAt: 0,
    key: 'role::role-a::::chat-1',
    title: '甲会话',
    targetName: '甲角色',
    roleName: '',
    avatarImage: '',
    roleAvatarImage: '',
    ...overrides,
  }
}

describe('侧边栏 B 会话行', () => {
  let host: HTMLDivElement | null = null
  let root: any = null

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    if (root) {
      act(() => root.unmount())
      root = null
    }
    host?.remove()
    host = null
  })

  function renderList(entries: DeskEntry[], runningChatIds: readonly string[] = []) {
    const theme = createStudioMuiTheme('light', getColorThemeColors(resolveColorThemePreview(undefined, null)))
    act(() => {
      root.render(
        <ThemeProvider theme={theme}>
          <DeskChatList
            entries={entries}
            drafts={[]}
            activeChatId=""
            runningChatIds={new Set(runningChatIds)}
            hoverShowsRoleIcon
            onOpen={noop}
            onRemove={noop}
            onMove={noop}
            onContextMenu={noop}
            onRemoveDraft={noop}
          />
        </ThemeProvider>,
      )
    })
  }

  function rowTextOf(title: string): string {
    const row = document.querySelector(`[aria-label="${title}"]`)
    expect(row).not.toBeNull()
    return row?.textContent || ''
  }

  it('角色来源的会话不运行也常驻角色名', () => {
    renderList([entry()])
    expect(rowTextOf('甲会话')).toContain('甲角色')
  })

  it('工作区来源的会话常驻「工作区名/角色名」，运行标记接在它右边', () => {
    renderList(
      [
        entry({
          targetKind: 'workspace',
          targetId: 'ws-1',
          roleId: 'role-b',
          key: 'workspace::ws-1::role-b::chat-2',
          chatId: 'chat-2',
          title: '乙会话',
          targetName: '工作区一',
          roleName: '乙角色',
        }),
      ],
      ['chat-2'],
    )

    const text = rowTextOf('乙会话')
    expect(text).toContain('工作区一/乙角色')
    expect(text).toContain('running...')
    expect(text.indexOf('工作区一/乙角色')).toBeLessThan(text.indexOf('running...'))
  })

  it('不运行的会话不显示 running 标记，来源字样仍在', () => {
    renderList([entry({ title: '丙会话', chatId: 'chat-3', key: 'role::role-a::::chat-3' })])
    const text = rowTextOf('丙会话')
    expect(text).toContain('甲角色')
    expect(text).not.toContain('running...')
  })
})
