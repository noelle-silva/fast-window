// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ThemeProvider } from '@mui/material'
import { getColorThemeColors, resolveColorThemePreview } from '../../../domain/colorTheme'
import type { FavoriteFolderLevelEntry } from '../../../domain/favoriteFolderLevel'
import { createStudioMuiTheme } from '../../colorThemeStyles'
import { FavoriteFoldersBrowser, type FavoriteFoldersBrowserProps } from './FavoriteFoldersBrowser'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const noop = () => {}

function entry(overrides: Partial<FavoriteFolderLevelEntry> = {}): FavoriteFolderLevelEntry {
  return {
    key: 'role::role-a::::chat-1',
    targetKind: 'role',
    targetId: 'role-a',
    roleId: '',
    chatId: 'chat-1',
    title: '甲会话',
    snippet: '最后一句',
    targetName: '甲角色',
    roleName: '',
    targetImage: '',
    roleAvatarImage: '',
    selected: false,
    status: 'loaded',
    runningKind: '',
    ...overrides,
  }
}

function createProps(overrides: Partial<FavoriteFoldersBrowserProps> = {}): FavoriteFoldersBrowserProps {
  return {
    level: { folders: [], refs: [] },
    canGoBack: false,
    onBack: noop,
    onCreateFolder: noop,
    onOpenRef: noop,
    onRefContextMenu: noop,
    onNavigate: noop,
    onReorderFolders: noop,
    onReorderRefs: noop,
    onMoveRef: noop,
    onRemoveRef: noop,
    onAddToDesk: noop,
    hoverShowsRoleIcon: true,
    ...overrides,
  }
}

describe('会话收藏夹层级浏览', () => {
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

  function renderBrowser(overrides: Partial<FavoriteFoldersBrowserProps> = {}) {
    const theme = createStudioMuiTheme('light', getColorThemeColors(resolveColorThemePreview(undefined, null)))
    act(() => {
      root.render(
        <ThemeProvider theme={theme}>
          <FavoriteFoldersBrowser {...createProps(overrides)} />
        </ThemeProvider>,
      )
    })
  }

  it('只铺当前层：子文件夹与会话同列出现', () => {
    renderBrowser({
      level: { folders: [{ id: 'f1', name: '甲文件夹' }], refs: [entry()] },
    })

    expect(host!.textContent).toContain('甲文件夹')
    expect(host!.textContent).toContain('甲会话')
    expect(host!.textContent).toContain('甲角色')
  })

  it('点文件夹进入下一层，不展开收起', () => {
    const seen: string[] = []
    renderBrowser({ level: { folders: [{ id: 'f1', name: '甲文件夹' }], refs: [] }, onNavigate: (id) => seen.push(id) })

    act(() => {
      ;(host!.querySelector('[role="button"][aria-label="甲文件夹"]') as HTMLElement).click()
    })

    expect(seen).toEqual(['f1'])
  })

  it('点会话把整条引用交回上层', () => {
    const opened: FavoriteFolderLevelEntry[] = []
    renderBrowser({ level: { folders: [], refs: [entry()] }, onOpenRef: (item) => opened.push(item) })

    act(() => {
      ;(host!.querySelector('[role="button"][aria-label="甲会话"]') as HTMLElement).click()
    })

    expect(opened.map((item) => item.chatId)).toEqual(['chat-1'])
  })

  it('普通点击只把会话打开，不碰工作桌面', () => {
    const added: FavoriteFolderLevelEntry[] = []
    renderBrowser({ level: { folders: [], refs: [entry()] }, onAddToDesk: (item) => added.push(item) })

    act(() => {
      ;(host!.querySelector('[role="button"][aria-label="甲会话"]') as HTMLElement).click()
    })

    expect(added).toEqual([])
  })

  it('Ctrl 点会话直接放进工作桌面，不再打开会话', () => {
    const opened: FavoriteFolderLevelEntry[] = []
    const added: FavoriteFolderLevelEntry[] = []
    renderBrowser({
      level: { folders: [], refs: [entry()] },
      onOpenRef: (item) => opened.push(item),
      onAddToDesk: (item) => added.push(item),
    })

    act(() => {
      ;(host!.querySelector('[role="button"][aria-label="甲会话"]') as HTMLElement).dispatchEvent(
        new MouseEvent('click', { bubbles: true, ctrlKey: true }),
      )
    })

    expect(added.map((item) => item.chatId)).toEqual(['chat-1'])
    expect(opened).toEqual([])
  })

  it('失效条目 Ctrl 点不进工作桌面：目标都没了', () => {
    const added: FavoriteFolderLevelEntry[] = []
    renderBrowser({
      level: {
        folders: [],
        refs: [entry({ key: 'role::role-gone::::chat-gone', targetId: 'role-gone', chatId: 'chat-gone', title: '已丢失的条目', status: 'missing' })],
      },
      onAddToDesk: (item) => added.push(item),
    })

    act(() => {
      ;(host!.querySelector('[role="button"][aria-label="已丢失的条目"]') as HTMLElement).dispatchEvent(
        new MouseEvent('click', { bubbles: true, ctrlKey: true }),
      )
    })

    expect(added).toEqual([])
  })

  it('当前会话落在选中态', () => {
    renderBrowser({ level: { folders: [], refs: [entry({ selected: true })] } })

    expect(host!.querySelector('[role="button"][aria-label="甲会话"]')!.getAttribute('aria-current')).toBe('true')
  })

  it('空文件夹给出提示', () => {
    renderBrowser()

    expect(host!.textContent).toContain('这个收藏夹还是空的')
  })

  it('返回按钮在分类自己的工具行最左侧，来路为空时禁用', () => {
    const seen: string[] = []
    renderBrowser({ canGoBack: false })
    expect((host!.querySelector('button[aria-label="返回上一层级"]') as HTMLButtonElement).disabled).toBe(true)

    renderBrowser({ canGoBack: true, onBack: () => seen.push('back') })
    const back = host!.querySelector('button[aria-label="返回上一层级"]') as HTMLButtonElement
    expect(back.disabled).toBe(false)
    act(() => back.click())
    expect(seen).toEqual(['back'])
  })

  it('工作区来源的条目带上「工作区/角色」，悬停换成角色头像', () => {
    const workspaceEntry = entry({
      key: 'workspace::ws-1::role-b::chat-2',
      targetKind: 'workspace',
      targetId: 'ws-1',
      roleId: 'role-b',
      chatId: 'chat-2',
      title: '乙会话',
      targetName: '工作区一',
      roleName: '乙角色',
      targetImage: 'ws-icon-src',
      roleAvatarImage: 'role-avatar-src',
    })
    renderBrowser({ level: { folders: [], refs: [workspaceEntry] } })

    expect(host!.textContent).toContain('工作区一/乙角色')
    const row = host!.querySelector('[role="button"][aria-label="乙会话"]') as HTMLElement
    expect(row.querySelector('img')!.getAttribute('src')).toBe('ws-icon-src')

    act(() => {
      row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    expect(row.querySelector('img')!.getAttribute('src')).toBe('role-avatar-src')
  })

  it('悬停图标开关关掉后，工作区条目保持工作区图标', () => {
    const workspaceEntry = entry({
      key: 'workspace::ws-1::role-b::chat-2',
      targetKind: 'workspace',
      targetId: 'ws-1',
      roleId: 'role-b',
      chatId: 'chat-2',
      title: '乙会话',
      targetName: '工作区一',
      roleName: '乙角色',
      targetImage: 'ws-icon-src',
      roleAvatarImage: 'role-avatar-src',
    })
    renderBrowser({ level: { folders: [], refs: [workspaceEntry] }, hoverShowsRoleIcon: false })

    const row = host!.querySelector('[role="button"][aria-label="乙会话"]') as HTMLElement
    act(() => {
      row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    expect(row.querySelector('img')!.getAttribute('src')).toBe('ws-icon-src')
  })

  it('失效条目显示出来，右键可以删除这一条', () => {
    const removed: string[] = []
    renderBrowser({
      level: {
        folders: [],
        refs: [
          entry({
            key: 'role::role-gone::::chat-gone',
            targetKind: 'role',
            targetId: 'role-gone',
            chatId: 'chat-gone',
            title: '已丢失的条目',
            targetName: '已删除的角色',
            status: 'missing',
          }),
        ],
      },
      onRemoveRef: (key) => removed.push(key),
    })

    expect(host!.textContent).toContain('已丢失的条目')
    const row = host!.querySelector('[role="button"][aria-label="已丢失的条目"]') as HTMLElement
    act(() => {
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }))
    })

    const item = Array.from(document.querySelectorAll('[role="menuitem"]')).find(
      (el) => el.textContent === '删除这条收藏',
    ) as HTMLElement
    expect(item).toBeTruthy()
    act(() => item.click())
    expect(removed).toEqual(['role::role-gone::::chat-gone'])
  })

  it('还没加载的会话显示占位，不当作已丢失，右键可以删除这一条', () => {
    const opened: FavoriteFolderLevelEntry[] = []
    const removed: string[] = []
    renderBrowser({
      level: {
        folders: [],
        refs: [entry({ key: 'role::role-a::::chat-9', chatId: 'chat-9', title: '会话待加载', status: 'pending' })],
      },
      onOpenRef: (item) => opened.push(item),
      onRemoveRef: (key) => removed.push(key),
    })

    expect(host!.textContent).toContain('会话待加载')
    const row = host!.querySelector('[role="button"][aria-label="会话待加载"]') as HTMLElement
    act(() => {
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }))
    })
    const item = Array.from(document.querySelectorAll('[role="menuitem"]')).find(
      (el) => el.textContent === '删除这条收藏',
    ) as HTMLElement
    expect(item).toBeTruthy()
    act(() => item.click())
    expect(removed).toEqual(['role::role-a::::chat-9'])

    act(() => row.click())
    expect(opened.map((item) => item.chatId)).toEqual(['chat-9'])
  })
})
