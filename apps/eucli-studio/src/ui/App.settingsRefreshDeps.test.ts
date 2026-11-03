import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const APP_SOURCE = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
const PLUGIN_SETTINGS_PAGE_SOURCE = readFileSync(new URL('./settings/PluginSettingsPage.tsx', import.meta.url), 'utf8')

function extractSettingsContentBlock(): string {
  const start = APP_SOURCE.indexOf('const settingsContent = React.useMemo')
  const end = APP_SOURCE.indexOf('const overlayImagePicker')
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return APP_SOURCE.slice(start, end)
}

function extractSettingsContentDeps(): string {
  const block = extractSettingsContentBlock()
  const depsStart = block.indexOf('), [')
  expect(depsStart).toBeGreaterThanOrEqual(0)
  return block.slice(depsStart)
}

describe('设置页刷新依赖', () => {
  it('settingsContent 依赖 navigation 版本，群组导航变化可让设置页重渲染', () => {
    expect(extractSettingsContentDeps()).toMatch(/\bnavigationVersion,/)
  })

  it('settingsContent 显式依赖 activeGroupId，并把派生值传给设置页', () => {
    const block = extractSettingsContentBlock()
    expect(block).toContain('activeGroupId={activeGroupId}')
    expect(extractSettingsContentDeps()).toMatch(/\bactiveGroupId,/)
  })

  it('PluginSettingsPage 接收 activeGroupId，并优先使用 App 传入的值', () => {
    expect(PLUGIN_SETTINGS_PAGE_SOURCE).toContain('activeGroupId?: string')
    expect(PLUGIN_SETTINGS_PAGE_SOURCE).toContain("activeGroupId={activeGroupId ?? String((draft as any)?.activeGroupId || '')}")
    expect(PLUGIN_SETTINGS_PAGE_SOURCE).not.toContain("activeGroupId={String((draft as any)?.activeGroupId || '')}")
  })
})
