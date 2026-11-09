// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ThemeProvider } from '@mui/material'
import { getColorThemeColors, resolveColorThemePreview } from '../../domain/colorTheme'
import { createStudioMuiTheme } from '../colorThemeStyles'
import { SidebarSessionList } from './SidebarSessionList'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const noop = () => {}

const sessions = [
  { id: 'chat-1', title: '甲会话', lastMessagePreview: '你好', updatedAt: 10 },
  { id: 'chat-2', title: '乙会话', lastMessagePreview: '在吗', updatedAt: 20 },
]

function createProps(overrides: Partial<React.ComponentProps<typeof SidebarSessionList>> = {}): React.ComponentProps<typeof SidebarSessionList> {
  return {
    title: '历史会话',
    sessions,
    pendingChat: null,
    pendingTitle: '历史会话',
    roleAvatarImage: '',
    searchText: '',
    targetKind: 'role',
    targetId: 'role-a',
    activeChatId: '',
    fmtTime: () => '',
    onSelect: noop,
    onAddToDesk: noop,
    onContextMenu: noop,
    chatSessionRunIndicatorKind: () => '',
    ...overrides,
  }
}

describe('会话行的快捷入桌面', () => {
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

  function renderList(overrides: Partial<React.ComponentProps<typeof SidebarSessionList>> = {}) {
    const theme = createStudioMuiTheme('light', getColorThemeColors(resolveColorThemePreview(undefined, null)))
    act(() => {
      root.render(
        <ThemeProvider theme={theme}>
          <SidebarSessionList {...createProps(overrides)} />
        </ThemeProvider>,
      )
    })
  }

  function rowOf(title: string): HTMLElement {
    const rows = Array.from(host!.querySelectorAll('.MuiListItemButton-root')) as HTMLElement[]
    const row = rows.find((it) => it.textContent?.includes(title))
    if (!row) throw new Error(`找不到会话行：${title}`)
    return row
  }

  it('按住 Ctrl 点击会话：交给入桌面动作，不切换会话', () => {
    const added: string[] = []
    const opened: string[] = []
    renderList({ onAddToDesk: (_kind, _targetId, chatId) => added.push(chatId), onSelect: (chatId) => opened.push(chatId) })

    act(() => {
      rowOf('乙会话').dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }))
    })

    expect(added).toEqual(['chat-2'])
    expect(opened).toEqual([])
  })

  it('工作区来源带着合成标识一起交出去', () => {
    const seen: string[] = []
    renderList({
      targetKind: 'workspace',
      targetId: 'ws-1|role-b',
      onAddToDesk: (kind, targetId, chatId) => seen.push(`${kind}:${targetId}:${chatId}`),
    })

    act(() => {
      rowOf('甲会话').dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }))
    })

    expect(seen).toEqual(['workspace:ws-1|role-b:chat-1'])
  })

  it('普通点击照常切换会话', () => {
    const added: string[] = []
    const opened: string[] = []
    renderList({ onAddToDesk: (_kind, _targetId, chatId) => added.push(chatId), onSelect: (chatId) => opened.push(chatId) })

    act(() => {
      rowOf('甲会话').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(opened).toEqual(['chat-1'])
    expect(added).toEqual([])
  })
})
