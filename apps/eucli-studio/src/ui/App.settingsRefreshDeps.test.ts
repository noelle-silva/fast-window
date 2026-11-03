import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const APP_SOURCE = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
const PLUGIN_SETTINGS_PAGE_SOURCE = readFileSync(new URL('./settings/PluginSettingsPage.tsx', import.meta.url), 'utf8')
const SETTINGS_PANEL_HOST_SOURCE = readFileSync(new URL('./settings/SettingsPanelHost.tsx', import.meta.url), 'utf8')

function extractSettingsContentBlock(): string {
  const start = APP_SOURCE.indexOf('const settingsContent = React.useMemo')
  const end = APP_SOURCE.indexOf('const overlayImagePicker')
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return APP_SOURCE.slice(start, end)
}

describe('设置页刷新机制', () => {
  it('App 不再向设置页手工传递实体数据或导航值', () => {
    const block = extractSettingsContentBlock()
    expect(block).not.toContain('domainVersion')
    expect(block).not.toContain('navigationVersion')
    expect(block).not.toContain('s.loading')
    expect(block).not.toContain('roles={roles}')
    expect(block).not.toContain('groups={groups}')
    expect(block).not.toContain('workspaces={workspaces}')
    expect(block).not.toContain('providers={providers}')
    expect(block).not.toContain('draft={s.draft}')
    expect(block).not.toContain('activeGroupId={activeGroupId}')
  })

  it('设置页内容只保留稳定入口，避免新增数据域漏登记', () => {
    const block = extractSettingsContentBlock()
    expect(block).toContain('<PluginSettingsPage')
    expect(block).toContain('controller={controller}')
    expect(block).toContain('tab={settingsTab}')
    expect(block).toContain('dataDirectory={dataDirectory}')
    expect(block).toContain('eucliBoxConnection={eucliBoxConnection}')
  })

  it('面板宿主按注册表地址自订阅，渲染期重新读取 controller 状态', () => {
    expect(SETTINGS_PANEL_HOST_SOURCE).toContain('useScopedUiVersions(controller, settingsPanelRefreshScopes(tab))')
    expect(SETTINGS_PANEL_HOST_SOURCE).toContain('readSettingsPanelState(controller)')
  })

  it('PluginSettingsPage 不再接收按值传入的导航事实', () => {
    expect(PLUGIN_SETTINGS_PAGE_SOURCE).not.toContain('activeGroupId?: string')
    expect(PLUGIN_SETTINGS_PAGE_SOURCE).not.toContain('activeRoleId: string')
    expect(PLUGIN_SETTINGS_PAGE_SOURCE).not.toContain('activeWorkspaceId: string')
    expect(PLUGIN_SETTINGS_PAGE_SOURCE).not.toContain('activeTargetKind: string')
    expect(PLUGIN_SETTINGS_PAGE_SOURCE).toContain('SETTINGS_PAGE_CHROME_REFRESH_SCOPES')
    expect(PLUGIN_SETTINGS_PAGE_SOURCE).toContain('SettingsPanelHost')
  })
})
