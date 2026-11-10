// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ThemeProvider } from '@mui/material'
import { getColorThemeColors, resolveColorThemePreview } from '../../../domain/colorTheme'
import type { DeskEntry } from '../../../domain/desks'
import { createStudioMuiTheme } from '../../colorThemeStyles'
import type { DeskNoticeDotKind } from '../../deskNotice'
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

  function renderList(
    entries: DeskEntry[],
    runningChatIds: readonly string[] = [],
    options: {
      noticeDotByKey?: Record<string, DeskNoticeDotKind>
      onOpen?: (entry: DeskEntry) => void
      onDismissNotice?: (entry: DeskEntry) => void
    } = {},
  ) {
    const theme = createStudioMuiTheme('light', getColorThemeColors(resolveColorThemePreview(undefined, null)))
    act(() => {
      root.render(
        <ThemeProvider theme={theme}>
          <DeskChatList
            entries={entries}
            drafts={[]}
            activeChatId=""
            runningChatIds={new Set(runningChatIds)}
            noticeDotByKey={options.noticeDotByKey || {}}
            hoverShowsRoleIcon
            onOpen={options.onOpen || noop}
            onRemove={noop}
            onDismissNotice={options.onDismissNotice || noop}
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

  it('没有通知时不画点', () => {
    renderList([entry()])
    expect(document.querySelector('[role="button"][aria-label="甲会话"] [aria-label="会话已完成，点一下标记已读"]')).toBeNull()
  })

  it('完成未读画绿点，点一下标记已读而不打开会话', () => {
    const dismissed: DeskEntry[] = []
    const opened: DeskEntry[] = []
    const target = entry()
    renderList([target], [], {
      noticeDotByKey: { [target.key]: 'completed' },
      onOpen: (item) => opened.push(item),
      onDismissNotice: (item) => dismissed.push(item),
    })

    const dot = document.querySelector('[aria-label="会话已完成，点一下标记已读"]') as HTMLElement
    expect(dot).not.toBeNull()
    act(() => dot.click())

    expect(dismissed.map((item) => item.chatId)).toEqual(['chat-1'])
    expect(opened).toEqual([])
  })

  it('异常中断画红点', () => {
    const target = entry()
    renderList([target], [], { noticeDotByKey: { [target.key]: 'error' } })
    expect(document.querySelector('[aria-label="会话异常中断，点一下标记已读"]')).not.toBeNull()
  })

  it('等待确认画黄点，点一下进会话去处理', () => {
    const dismissed: DeskEntry[] = []
    const opened: DeskEntry[] = []
    const target = entry()
    renderList([target], [], {
      noticeDotByKey: { [target.key]: 'waiting_confirmation' },
      onOpen: (item) => opened.push(item),
      onDismissNotice: (item) => dismissed.push(item),
    })

    const dot = document.querySelector('[aria-label="有工具请求等待确认，点一下去处理"]') as HTMLElement
    expect(dot).not.toBeNull()
    act(() => dot.click())

    expect(opened.map((item) => item.chatId)).toEqual(['chat-1'])
    expect(dismissed).toEqual([])
  })
})
