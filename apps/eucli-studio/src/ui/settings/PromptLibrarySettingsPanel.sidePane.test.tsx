// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PromptLibrarySettingsPanel } from './PromptLibrarySettingsPanel'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const EMPTY_FOLDER_LIBRARY = { rootFolderIds: [], rootEntryOrder: [], folders: [] }

function createController() {
  return {
    actions: {
      loadPromptLibrary: async () => ({ prompts: [] }),
      loadPromptFolders: async () => EMPTY_FOLDER_LIBRARY,
    },
  }
}

describe('提示词库面板的右侧附加栏', () => {
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

  async function renderPanel(sidePane?: React.ReactNode) {
    await act(async () => {
      root.render(<PromptLibrarySettingsPanel controller={createController()} sidePane={sidePane} />)
    })
  }

  it('调用方传了附加栏就渲染在面板最右侧', async () => {
    await renderPanel(<div>当前输入框那一栏</div>)
    expect(host?.textContent).toContain('当前输入框那一栏')
  })

  it('设置页不传附加栏时保持原来的两栏', async () => {
    await renderPanel()
    expect(host?.textContent).not.toContain('当前输入框那一栏')
    expect(host?.textContent).toContain('全局提示词')
  })
})
