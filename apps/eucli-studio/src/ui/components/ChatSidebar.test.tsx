// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ThemeProvider } from '@mui/material'
import { getColorThemeColors, resolveColorThemePreview } from '../../domain/colorTheme'
import { resetSidebarNavigationMemory, setRoleSidebarTab, setWorkspaceSidebarTab } from '../../domain/sidebarNavigationMemory'
import { refreshScopes } from '../../domain/uiRefreshScope'
import { createStudioMuiTheme } from '../colorThemeStyles'
import { createUiCore } from '../uiCore'
import { ChatSidebar } from './ChatSidebar'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const roles = [
  { id: 'role-a', name: '甲角色' },
  { id: 'role-b', name: '乙角色' },
  { id: 'role-c', name: '丙角色' },
]

const workspaces = [
  { id: 'ws-1', name: '工作区一', registeredRoleIds: ['role-a'] },
]

const noop = () => {}

function createController() {
  return {
    getSnapshot: () => 0,
    subscribe: () => () => {},
    actions: { openRoleEditor: noop, openWorkspaceEditor: noop },
  } as any
}

function createScopedController(uiCore: ReturnType<typeof createUiCore>) {
  return {
    getSnapshot: () => uiCore.getVer(),
    subscribe: uiCore.subscribe,
    getScopeVer: (scope: string) => uiCore.getScopeVer(scope),
    subscribeScope: (scope: string, fn: () => void) => uiCore.subscribeScope(scope, fn),
    actions: { openRoleEditor: noop, openWorkspaceEditor: noop },
  } as any
}

function createProps(overrides: Partial<React.ComponentProps<typeof ChatSidebar>> = {}): React.ComponentProps<typeof ChatSidebar> {
  return {
    controller: createController(),
    side: 'left',
    view: 'role',
    onToggleView: noop,
    width: 280,
    sidebarRef: null,
    resizing: false,
    onSplitterPointerDown: noop,
    topbarOpacity: 100,
    topbarBlur: 0,
    tabsVariant: 'soft',
    roles,
    workspaceRoles: [],
    workspaces,
    activeRoleId: 'role-a',
    activeRoleAvatarImage: '',
    activeWorkspaceId: 'ws-1',
    activeTargetKind: 'workspace',
    activeChatId: '',
    data: { chatsByRole: {}, chatsByWorkspace: {} },
    pendingRoleChat: null,
    pendingWorkspaceChat: null,
    formatModelRefText: () => '',
    openPluginSettings: noop,
    fmtTime: () => '',
    chatSessionRunIndicatorKind: () => '',
    onSelectRole: noop,
    onSelectWorkspace: noop,
    onSelectWorkspaceRole: noop,
    onMoveRole: noop,
    onMoveWorkspace: noop,
    onSelectSession: noop,
    onChatContextMenu: noop,
    onTabChange: noop,
    ...overrides,
  }
}

describe('侧边栏视图的角色范围', () => {
  let host: HTMLDivElement | null = null
  let root: any = null

  beforeEach(() => {
    resetSidebarNavigationMemory()
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

  function renderSidebar(overrides: Partial<React.ComponentProps<typeof ChatSidebar>> = {}) {
    const theme = createStudioMuiTheme('light', getColorThemeColors(resolveColorThemePreview(undefined, null)))
    act(() => {
      root.render(
        <ThemeProvider theme={theme}>
          <ChatSidebar {...createProps(overrides)} />
        </ThemeProvider>,
      )
    })
  }

  it('角色视图展示全部角色，不受当前聊天目标停在工作区的影响', () => {
    renderSidebar({ view: 'role', activeTargetKind: 'workspace' })

    expect(host!.textContent).toContain('甲角色')
    expect(host!.textContent).toContain('乙角色')
    expect(host!.textContent).toContain('丙角色')
  })

  it('工作区视图的角色页签只展示工作区注册角色，即使当前目标是角色', () => {
    setWorkspaceSidebarTab('roles')
    renderSidebar({ view: 'workspace', activeTargetKind: 'role', workspaceRoles: [roles[0]] })

    expect(host!.textContent).toContain('甲角色')
    expect(host!.textContent).not.toContain('乙角色')
    expect(host!.textContent).not.toContain('丙角色')
  })

  it('当前 target 的 chatList scope 变化时侧边栏更新，且不推进全局版本', () => {
    const uiCore = createUiCore()
    const data: any = { chatsByRole: { 'role-a': { activeChatId: '', chatMetas: [], chats: [] } }, chatsByWorkspace: {} }
    setRoleSidebarTab('history')
    renderSidebar({
      controller: createScopedController(uiCore),
      data,
      view: 'role',
      activeTargetKind: 'role',
      activeRoleId: 'role-a',
      activeChatId: '',
    })

    expect(host!.textContent).toContain('还没有会话')
    const globalVersion = uiCore.getVer()

    act(() => {
      data.chatsByRole['role-a'].chatMetas.push({ id: 'c1', title: '后到会话', updatedAt: 100 })
      uiCore.emitScope(refreshScopes.chatList('role', 'role-a'))
    })

    expect(uiCore.getVer()).toBe(globalVersion)
    expect(host!.textContent).toContain('后到会话')
  })

  it('全局 emit 不再兜底刷新侧边栏：只有范围地址能穿透', () => {
    const uiCore = createUiCore()
    const data: any = { chatsByRole: { 'role-a': { activeChatId: '', chatMetas: [], chats: [] } }, chatsByWorkspace: {} }
    setRoleSidebarTab('history')
    renderSidebar({
      controller: createScopedController(uiCore),
      data,
      view: 'role',
      activeTargetKind: 'role',
      activeRoleId: 'role-a',
      activeChatId: '',
    })

    expect(host!.textContent).toContain('还没有会话')

    act(() => {
      data.chatsByRole['role-a'].chatMetas.push({ id: 'c1', title: '只经全局变化', updatedAt: 100 })
      uiCore.emit()
    })

    expect(host!.textContent).not.toContain('只经全局变化')
  })
})

describe('侧边栏 A 的列表搜索', () => {
  let host: HTMLDivElement | null = null
  let root: any = null

  const projectWorkspaces = [
    { id: 'ws-1', name: '项目甲' },
    { id: 'ws-2', name: '项目乙' },
  ]

  beforeEach(() => {
    resetSidebarNavigationMemory()
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

  function renderSidebar(overrides: Partial<React.ComponentProps<typeof ChatSidebar>> = {}) {
    const theme = createStudioMuiTheme('light', getColorThemeColors(resolveColorThemePreview(undefined, null)))
    act(() => {
      root.render(
        <ThemeProvider theme={theme}>
          <ChatSidebar {...createProps(overrides)} />
        </ThemeProvider>,
      )
    })
  }

  function searchInput(): HTMLInputElement {
    const input = host!.querySelector('input')
    if (!input) throw new Error('侧边栏没有搜索框')
    return input as HTMLInputElement
  }

  function typeSearch(text: string) {
    const input = searchInput()
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    act(() => {
      setValue.call(input, text)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  function captionTexts(): string[] {
    return Array.from(host!.querySelectorAll('.MuiTypography-caption')).map((el) => String(el.textContent || ''))
  }

  it('工作区页签：分组标题让位给搜索框，输入即过滤清单', () => {
    setWorkspaceSidebarTab('workspaces')
    renderSidebar({ view: 'workspace', workspaces: projectWorkspaces })

    expect(captionTexts()).not.toContain('工作区')
    expect(host!.textContent).toContain('项目甲')
    expect(host!.textContent).toContain('项目乙')

    typeSearch('乙')

    expect(host!.textContent).toContain('项目乙')
    expect(host!.textContent).not.toContain('项目甲')
  })

  it('角色页签：搜索框实时过滤角色清单', () => {
    setWorkspaceSidebarTab('roles')
    renderSidebar({ view: 'workspace', workspaceRoles: roles })

    typeSearch('乙')

    expect(searchInput().value).toBe('乙')
    expect(host!.textContent).toContain('乙角色')
    expect(host!.textContent).not.toContain('甲角色')
    expect(host!.textContent).not.toContain('丙角色')
  })

  it('搜索词只属于输入时那一个页签，切页签就失效', () => {
    setWorkspaceSidebarTab('workspaces')
    const props: Partial<React.ComponentProps<typeof ChatSidebar>> = {
      view: 'workspace',
      workspaces: projectWorkspaces,
      workspaceRoles: roles,
    }
    renderSidebar(props)
    typeSearch('乙')
    expect(host!.textContent).not.toContain('项目甲')

    act(() => setWorkspaceSidebarTab('roles'))
    renderSidebar(props)

    expect(searchInput().value).toBe('')
    expect(host!.textContent).toContain('甲角色')
    expect(host!.textContent).toContain('丙角色')
  })

  it('会话页签的搜索框照旧实时过滤会话', () => {
    setRoleSidebarTab('history')
    const data: any = {
      chatsByRole: {
        'role-a': {
          activeChatId: '',
          chatMetas: [
            { id: 'c1', title: '甲会话', updatedAt: 10 },
            { id: 'c2', title: '乙会话', updatedAt: 20 },
          ],
        },
      },
      chatsByWorkspace: {},
    }
    renderSidebar({ view: 'role', activeTargetKind: 'role', activeRoleId: 'role-a', data })

    // 分类名已经写在页签上，清单顶上不再重复一行「历史会话」。
    expect(captionTexts()).not.toContain('历史会话')
    expect(searchInput().placeholder).toBe('')
    expect(searchInput().getAttribute('aria-label')).toBe('搜索列表')

    typeSearch('乙会话')

    expect(host!.textContent).toContain('乙会话')
    expect(host!.textContent).not.toContain('甲会话')
  })
})
