// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ThemeProvider } from '@mui/material'
import { getColorThemeColors, resolveColorThemePreview } from '../../domain/colorTheme'
import { createStudioMuiTheme } from '../colorThemeStyles'
import { ChatContextMenus } from './ChatContextMenus'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const noop = () => {}

type MenuProps = React.ComponentProps<typeof ChatContextMenus>

function createController(deskCalls: any[][]) {
  return {
    getSnapshot: () => 0,
    subscribe: () => () => {},
    getScopeVer: () => 0,
    subscribeScope: () => () => {},
    actions: {
      addChatToDesk: (...args: any[]) => {
        deskCalls.push(args)
      },
      getChatFavoriteFolderIds: () => [],
      setChatFavoriteFolders: noop,
      aiGenerateChatTitle: noop,
      aiGenerateGroupChatTitle: noop,
      aiGenerateWorkspaceChatTitle: noop,
    },
  } as any
}

function createProps(deskCalls: any[][], overrides: Partial<MenuProps> = {}): MenuProps {
  return {
    controller: createController(deskCalls),
    loading: false,
    favoriteFolderMenu: { folderId: '', parentId: '', x: 0, y: 0 },
    closeFavoriteFolderMenu: noop,
    openCreateFavoriteFolder: noop,
    setMoveFavoriteFolderDialog: noop as any,
    openRenameFavoriteFolder: noop,
    setConfirmClearFavoriteFolder: noop as any,
    openDeleteFavoriteFolderConfirm: noop,
    favoriteChatMenu: { folderId: '', targetKind: 'role', targetId: '', roleId: '', chatId: '', title: '', x: 0, y: 0 },
    closeFavoriteChatMenu: noop,
    openFavoriteDialog: noop,
    setEditingChatTitle: noop as any,
    isSendingThisChat: () => false,
    chatMenu: { targetKind: 'role', targetId: '', chatId: '', title: '', x: 0, y: 0 },
    closeChatMenu: noop,
    setConfirmDelChat: noop as any,
    ...overrides,
  }
}

function menuItem(text: string) {
  return Array.from(document.querySelectorAll('[role="menuitem"]')).find((el) =>
    String(el.textContent || '').includes(text),
  ) as HTMLElement | undefined
}

// 会话菜单里的「添加到工作桌面」：侧边栏会话与收藏夹两条入口最后都落到同一个动作，
// 差别只在 targetId 的口径。这里把两种口径各钉一条用例。
describe('会话右键菜单进工作桌面', () => {
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
  })

  function renderMenus(deskCalls: any[][], overrides: Partial<MenuProps> = {}) {
    const theme = createStudioMuiTheme('light', getColorThemeColors(resolveColorThemePreview(undefined, null)))
    return act(async () => {
      root.render(
        <ThemeProvider theme={theme}>
          <ChatContextMenus {...createProps(deskCalls, overrides)} />
        </ThemeProvider>,
      )
    })
  }

  it('收藏夹里的会话可以直接放进工作桌面', async () => {
    const deskCalls: any[][] = []
    await renderMenus(deskCalls, {
      favoriteChatMenu: {
        folderId: 'f1',
        targetKind: 'role',
        targetId: 'role-a',
        roleId: '',
        chatId: 'chat-1',
        title: '甲会话',
        x: 10,
        y: 10,
      },
    })

    const item = menuItem('添加到工作桌面')
    expect(item).toBeTruthy()
    await act(async () => {
      item!.click()
    })

    expect(deskCalls).toEqual([['role', 'role-a', '', 'chat-1']])

    const items = Array.from(document.querySelectorAll('[role="menuitem"]')).map((el) => String(el.textContent || ''))
    expect(items.filter((text) => text.includes('文件夹'))).toEqual([])
  })

  it('收藏夹里的工作区会话按三段口径进桌面', async () => {
    const deskCalls: any[][] = []
    await renderMenus(deskCalls, {
      favoriteChatMenu: {
        folderId: 'f1',
        targetKind: 'workspace',
        targetId: 'ws-1',
        roleId: 'role-b',
        chatId: 'chat-2',
        title: '乙会话',
        x: 10,
        y: 10,
      },
    })

    const item = menuItem('添加到工作桌面')
    expect(item).toBeTruthy()
    await act(async () => {
      item!.click()
    })

    expect(deskCalls).toEqual([['workspace', 'ws-1', 'role-b', 'chat-2']])
  })

  it('侧边栏会话菜单仍按「工作区|角色」合成串折回三段', async () => {
    const deskCalls: any[][] = []
    await renderMenus(deskCalls, {
      chatMenu: { targetKind: 'workspace', targetId: 'ws-1::role-b', chatId: 'chat-2', title: '乙会话', x: 10, y: 10 },
    })

    const item = menuItem('添加到工作桌面')
    expect(item).toBeTruthy()
    await act(async () => {
      item!.click()
    })

    expect(deskCalls).toEqual([['workspace', 'ws-1', 'role-b', 'chat-2']])
  })

  it('工作区目标拆不出角色时，菜单项置灰', async () => {
    const deskCalls: any[][] = []
    await renderMenus(deskCalls, {
      chatMenu: { targetKind: 'workspace', targetId: 'ws-1', chatId: 'chat-2', title: '乙会话', x: 10, y: 10 },
    })

    const item = menuItem('添加到工作桌面')
    expect(item).toBeTruthy()
    expect(item!.getAttribute('aria-disabled')).toBe('true')
    expect(item!.className).toContain('Mui-disabled')
  })

  it('收藏夹文件夹菜单统一按收藏夹叫法，不再出现「文件夹」', async () => {
    const cleared: any[] = []
    await renderMenus([], {
      favoriteFolderMenu: { folderId: 'f1', parentId: '', x: 10, y: 10 },
      setConfirmClearFavoriteFolder: ((next: any) => cleared.push(next)) as any,
    })

    const items = Array.from(document.querySelectorAll('[role="menuitem"]')).map((el) => String(el.textContent || ''))
    expect(items.length).toBeGreaterThan(0)
    expect(items.filter((text) => text.includes('文件夹'))).toEqual([])

    const item = menuItem('清空当前收藏夹的收藏')
    expect(item).toBeTruthy()

    await act(async () => {
      item!.click()
    })
    expect(cleared).toEqual([{ open: true, folderId: 'f1' }])
  })
})
