// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PromptLibrarySettingsPanel } from './PromptLibrarySettingsPanel'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const EMPTY_FOLDER_LIBRARY = { rootFolderIds: [], rootEntryOrder: [], folders: [] }

function createController(calls: any[][]) {
  return {
    actions: {
      loadPromptLibrary: async (scope: string, ownerId: string) => {
        calls.push(['library', scope, ownerId])
        return { prompts: [] }
      },
      loadPromptFolders: async (scope: string, ownerId: string) => {
        calls.push(['folders', scope, ownerId])
        return EMPTY_FOLDER_LIBRARY
      },
    },
  }
}

describe('提示词库面板的初始作用域', () => {
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

  it('loads the global library by default', async () => {
    const calls: any[][] = []
    await act(async () => {
      root.render(<PromptLibrarySettingsPanel controller={createController(calls)} />)
    })

    expect(calls).toContainEqual(['library', 'global', ''])
    expect(host!.textContent).toContain('全局提示词')
  })

  it('opens on the requested scope with the requested owner', async () => {
    const calls: any[][] = []
    await act(async () => {
      root.render(
        <PromptLibrarySettingsPanel
          controller={createController(calls)}
          roles={[{ id: 'role-1', name: '甲角色' }]}
          initialScope="role"
          initialOwnerId="role-1"
        />,
      )
    })

    expect(calls).toContainEqual(['library', 'role', 'role-1'])
    expect(host!.textContent).toContain('甲角色')
    // 归属控件只对角色 / 工作区出现；新建按钮在它左边、搜索固定在右侧。
    expect(host!.querySelector('#prompt-library-owner-label')).not.toBeNull()
  })

  it('falls back to the first owner when the requested one is missing', async () => {
    const calls: any[][] = []
    await act(async () => {
      root.render(
        <PromptLibrarySettingsPanel
          controller={createController(calls)}
          workspaces={[{ id: 'ws-1', name: '甲工作区' }]}
          initialScope="workspace"
          initialOwnerId="missing"
        />,
      )
    })

    expect(calls).toContainEqual(['library', 'workspace', 'ws-1'])
  })

  it('does not render the owner controls in the global scope', async () => {
    const calls: any[][] = []
    await act(async () => {
      root.render(<PromptLibrarySettingsPanel controller={createController(calls)} />)
    })

    // 两端锚定：新建按钮在左、搜索在右，中间不渲染归属控件也不会让它们换位。
    expect(host!.querySelector('#prompt-library-owner-label')).toBeNull()
    expect(host!.textContent).toContain('新建收藏夹')
    expect(host!.querySelector('input[placeholder="搜索当前层"]')).not.toBeNull()
  })
})
