// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ThemeProvider } from '@mui/material'
import { getColorThemeColors, resolveColorThemePreview } from '../../domain/colorTheme'
import type { DeskEntry } from '../../domain/desk'
import { createStudioMuiTheme } from '../colorThemeStyles'
import { SidebarBPanel } from './SidebarBPanel'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const noop = () => {}

function entry(overrides: Partial<DeskEntry> = {}): DeskEntry {
  return {
    targetKind: 'role',
    targetId: 'role-a',
    roleId: '',
    chatId: 'chat-1',
    addedAt: 1,
    key: 'role::role-a::::chat-1',
    title: '甲会话',
    targetName: '甲角色',
    roleName: '',
    avatarImage: '',
    roleAvatarImage: '',
    ...overrides,
  }
}

const deskEntries = [
  entry(),
  entry({ targetId: 'ws-1', roleId: 'role-b', chatId: 'chat-2', key: 'workspace::ws-1::role-b::chat-2', title: '乙会话', targetName: '工作区一', targetKind: 'workspace' }),
]

function createProps(overrides: Partial<React.ComponentProps<typeof SidebarBPanel>> = {}): React.ComponentProps<typeof SidebarBPanel> {
  return {
    side: 'right',
    width: 260,
    sidebarRef: null,
    resizing: false,
    onSplitterPointerDown: noop,
    topbarOpacity: 100,
    topbarBlur: 0,
    deskEntries,
    activeChatId: '',
    hoverShowsRoleIcon: true,
    onOpenDeskEntry: noop,
    onRemoveDeskEntry: noop,
    onMoveDeskEntry: noop,
    onDeskEntryContextMenu: noop,
    ...overrides,
  }
}

describe('侧边栏 B 的工作桌面', () => {
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

  function renderPanel(overrides: Partial<React.ComponentProps<typeof SidebarBPanel>> = {}) {
    const theme = createStudioMuiTheme('light', getColorThemeColors(resolveColorThemePreview(undefined, null)))
    act(() => {
      root.render(
        <ThemeProvider theme={theme}>
          <SidebarBPanel {...createProps(overrides)} />
        </ThemeProvider>,
      )
    })
  }

  it('按桌面顺序列出会话条目', () => {
    renderPanel()

    expect(host!.textContent).toContain('甲会话')
    expect(host!.textContent).toContain('乙会话')
  })

  it('每一条都带自己的移除按钮', () => {
    renderPanel()

    expect(host!.querySelector('[aria-label="从工作桌面移除 甲会话"]')).toBeTruthy()
    expect(host!.querySelector('[aria-label="从工作桌面移除 乙会话"]')).toBeTruthy()
  })

  it('点行交给打开动作，点叉交给移除动作且不连带打开', () => {
    const opened: DeskEntry[] = []
    const removed: DeskEntry[] = []
    renderPanel({ onOpenDeskEntry: (it) => opened.push(it), onRemoveDeskEntry: (it) => removed.push(it) })

    const row = host!.querySelector('[role="button"][aria-label="甲会话"]') as HTMLElement
    act(() => {
      row.click()
    })
    expect(opened.map((it) => it.chatId)).toEqual(['chat-1'])

    const removeButton = host!.querySelector('[aria-label="从工作桌面移除 乙会话"]') as HTMLElement
    act(() => {
      removeButton.click()
    })
    expect(removed.map((it) => it.chatId)).toEqual(['chat-2'])
    expect(opened.map((it) => it.chatId)).toEqual(['chat-1'])
  })

  it('每一行都挂着可拖排序的句柄声明', () => {
    renderPanel()

    const first = host!.querySelector('[role="button"][aria-label="甲会话"]') as HTMLElement
    const second = host!.querySelector('[role="button"][aria-label="乙会话"]') as HTMLElement
    expect(first.getAttribute('aria-roledescription')).toBe('sortable')
    expect(second.getAttribute('aria-roledescription')).toBe('sortable')
  })

  it('每一条都能弹与会话列表同一个右键菜单', () => {
    const seen: string[] = []
    renderPanel({ onDeskEntryContextMenu: (_event, it) => seen.push(it.chatId) })

    const row = host!.querySelector('[role="button"][aria-label="甲会话"]') as HTMLElement
    act(() => {
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    })
    expect(seen).toEqual(['chat-1'])
  })

  it('图标槽对角色与工作区用同一个尺寸', () => {
    renderPanel()

    const slots = Array.from(host!.querySelectorAll('[role="button"] img, [role="button"] svg'))
    expect(slots.length).toBeGreaterThan(0)
    const boxes = Array.from(host!.querySelectorAll('[role="button"] > div:first-child')) as HTMLElement[]
    expect(boxes).toHaveLength(2)
  })

  it('当前正在看的会话有选中状态，其它条目没有', () => {
    renderPanel({ activeChatId: 'chat-2' })

    const active = host!.querySelector('[role="button"][aria-label="乙会话"]') as HTMLElement
    const other = host!.querySelector('[role="button"][aria-label="甲会话"]') as HTMLElement
    expect(active.getAttribute('aria-current')).toBe('true')
    expect(other.getAttribute('aria-current')).toBeNull()
  })

  it('工作区条目悬停换成所属角色图标，开关关掉就一直是工作区图标', () => {
    const wsEntry = entry({
      targetKind: 'workspace',
      targetId: 'ws-1',
      roleId: 'role-b',
      chatId: 'chat-2',
      key: 'workspace::ws-1::role-b::chat-2',
      title: '乙会话',
      targetName: '工作区一',
      roleName: '乙角色',
      avatarImage: 'ws-icon-src',
      roleAvatarImage: 'role-avatar-src',
    })

    renderPanel({ deskEntries: [wsEntry] })
    const row = host!.querySelector('[role="button"][aria-label="乙会话"]') as HTMLElement
    expect(row.querySelector('img')!.getAttribute('src')).toBe('ws-icon-src')

    act(() => {
      row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    expect(row.querySelector('img')!.getAttribute('src')).toBe('role-avatar-src')

    renderPanel({ deskEntries: [wsEntry], hoverShowsRoleIcon: false })
    const quiet = host!.querySelector('[role="button"][aria-label="乙会话"]') as HTMLElement
    act(() => {
      quiet.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    expect(quiet.querySelector('img')!.getAttribute('src')).toBe('ws-icon-src')
  })

  it('桌面为空时给出空态提示', () => {
    renderPanel({ deskEntries: [] })

    expect(host!.textContent).toContain('桌面上还没有会话')
  })
})
