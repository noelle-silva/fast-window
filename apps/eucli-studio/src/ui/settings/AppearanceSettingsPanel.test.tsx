// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./ColorThemeSettingsSection', () => ({ ColorThemeSettingsSection: () => null }))
vi.mock('./WallpaperSettingsSection', () => ({ WallpaperSettingsSection: () => null }))

import { AppearanceSettingsPanel } from './AppearanceSettingsPanel'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

function switchForSection(host: HTMLElement, title: string) {
  const label = Array.from(host.querySelectorAll('p')).find((node) => node.textContent === title)
  if (!label) throw new Error(`section not found: ${title}`)
  let node: HTMLElement | null = label
  while (node && !node.querySelector('input[type="checkbox"]')) node = node.parentElement
  const input = node?.querySelector('input[type="checkbox"]')
  if (!input) throw new Error(`switch not found: ${title}`)
  return input as HTMLInputElement
}

describe('外观设置消息屏外跳过', () => {
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

  function renderPanel(settings: Record<string, any>, actions: Record<string, any>) {
    return (
      <AppearanceSettingsPanel
        controller={{ actions, capabilities: {} }}
        loading={false}
        data={{ settings }}
        draft={{}}
      />
    )
  }

  it('独立区块默认开启，关闭后立即回传开关动作', async () => {
    const setMessageOffscreenSkipEnabled = vi.fn()

    await act(async () => {
      root.render(renderPanel({}, { setMessageOffscreenSkipEnabled }))
    })
    expect(switchForSection(host!, '消息屏外跳过').checked).toBe(true)

    await act(async () => {
      switchForSection(host!, '消息屏外跳过').click()
    })
    expect(setMessageOffscreenSkipEnabled).toHaveBeenCalledWith(false)

    await act(async () => {
      root.render(renderPanel({ messageOffscreenSkipEnabled: false }, { setMessageOffscreenSkipEnabled }))
    })
    expect(switchForSection(host!, '消息屏外跳过').checked).toBe(false)
  })
})
