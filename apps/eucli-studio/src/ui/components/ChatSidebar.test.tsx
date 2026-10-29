// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ThemeProvider } from '@mui/material'
import { getColorThemeColors, resolveColorThemePreview } from '../../domain/colorTheme'
import { resetSidebarNavigationMemory, setWorkspaceSidebarTab } from '../../domain/sidebarNavigationMemory'
import { createStudioMuiTheme } from '../colorThemeStyles'
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
})
