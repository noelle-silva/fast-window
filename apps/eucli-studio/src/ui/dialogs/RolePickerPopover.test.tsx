// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ThemeProvider } from '@mui/material'
import { getColorThemeColors, resolveColorThemePreview } from '../../domain/colorTheme'
import { createStudioMuiTheme } from '../colorThemeStyles'
import { RolePickerPopover } from './RolePickerPopover'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const roles = [
  { id: 'role-a', name: '甲角色' },
  { id: 'role-b', name: '乙角色' },
  { id: 'role-c', name: '丙角色' },
]

const noop = () => {}

function createController() {
  return {
    getSnapshot: () => 0,
    subscribe: () => () => {},
    actions: { setActiveRole: noop, setWorkspaceRole: noop, openRoleEditor: noop },
  } as any
}

describe('角色选择器的角色范围', () => {
  let host: HTMLDivElement | null = null
  let anchor: HTMLButtonElement | null = null
  let root: any = null

  beforeEach(() => {
    host = document.createElement('div')
    anchor = document.createElement('button')
    document.body.appendChild(host)
    document.body.appendChild(anchor)
    root = createRoot(host)
  })

  afterEach(() => {
    if (root) {
      act(() => root.unmount())
      root = null
    }
    host?.remove()
    host = null
    anchor?.remove()
    anchor = null
  })

  function renderPicker(view: 'role' | 'workspaceRole', workspaceRoles: any[]) {
    const theme = createStudioMuiTheme('light', getColorThemeColors(resolveColorThemePreview(undefined, null)))
    act(() => {
      root.render(
        <ThemeProvider theme={theme}>
          <RolePickerPopover
            controller={createController()}
            rolePickerEl={anchor}
            closeRolePicker={noop}
            rolePickerView={view}
            roles={roles}
            workspaceRoles={workspaceRoles}
            workspaces={[{ id: 'ws-1', name: '工作区一' }]}
            draftActiveRoleId="role-a"
            activeWorkspaceId="ws-1"
            activeTargetKind="workspace"
            formatModelRefText={() => ''}
            openPluginSettings={noop}
          />
        </ThemeProvider>,
      )
    })
  }

  it('角色视图展示全部角色', () => {
    renderPicker('role', [roles[0]])

    expect(document.body.textContent).toContain('甲角色')
    expect(document.body.textContent).toContain('乙角色')
    expect(document.body.textContent).toContain('丙角色')
  })

  it('工作区角色视图只展示工作区注册角色', () => {
    renderPicker('workspaceRole', [roles[0]])

    expect(document.body.textContent).toContain('甲角色')
    expect(document.body.textContent).not.toContain('乙角色')
    expect(document.body.textContent).not.toContain('丙角色')
  })
})
