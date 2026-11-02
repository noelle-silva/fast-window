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
})
