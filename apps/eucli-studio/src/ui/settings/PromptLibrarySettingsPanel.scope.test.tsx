// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

    // 全局库没有归属可选；两个新建动作收在左侧栏顶部，搜索常驻在它下面。
    expect(host!.querySelector('#prompt-library-owner-label')).toBeNull()
    expect(host!.querySelector('[aria-label="新建收藏夹"]')).not.toBeNull()
    expect(host!.querySelector('[aria-label="新建提示词"]')).not.toBeNull()
    expect(host!.querySelector('input[placeholder="搜索当前层"]')).not.toBeNull()
  })

  const switchScope = async (label: string) => {
    const button = Array.from(host!.querySelectorAll('button')).find((node) => String(node.textContent || '') === label)
    expect(button).not.toBeUndefined()
    await act(async () => {
      button!.click()
    })
  }

  it('follows the preferred owner when switching scopes', async () => {
    const calls: any[][] = []
    await act(async () => {
      root.render(
        <PromptLibrarySettingsPanel
          controller={createController(calls)}
          roles={[{ id: 'role-1', name: '甲角色' }, { id: 'role-2', name: '乙角色' }]}
          workspaces={[{ id: 'ws-1', name: '甲工作区' }, { id: 'ws-2', name: '乙工作区' }]}
          preferredOwnerIds={{ role: 'role-2', workspace: 'ws-2' }}
        />,
      )
    })

    await switchScope('角色提示词')
    expect(calls).toContainEqual(['library', 'role', 'role-2'])

    await switchScope('工作区提示词')
    expect(calls).toContainEqual(['library', 'workspace', 'ws-2'])
  })

  it('falls back to the first owner when no preferred id exists', async () => {
    const calls: any[][] = []
    await act(async () => {
      root.render(
        <PromptLibrarySettingsPanel
          controller={createController(calls)}
          roles={[{ id: 'role-1', name: '甲角色' }, { id: 'role-2', name: '乙角色' }]}
        />,
      )
    })

    await switchScope('角色提示词')
    expect(calls).toContainEqual(['library', 'role', 'role-1'])
  })

  it('restores the remembered owner and folder for the opening scope', async () => {
    const calls: any[][] = []
    const browse = vi.fn()
    await act(async () => {
      root.render(
        <PromptLibrarySettingsPanel
          controller={createController(calls)}
          roles={[{ id: 'role-1', name: '甲角色' }, { id: 'role-2', name: '乙角色' }]}
          initialScope="role"
          browseState={{ role: { ownerId: 'role-2', folderId: 'f1' } }}
          onBrowseStateChange={browse}
        />,
      )
    })

    expect(calls).toContainEqual(['library', 'role', 'role-2'])
    expect(browse).toHaveBeenCalledWith('role', expect.objectContaining({ ownerId: 'role-2', folderId: 'f1' }))
  })

  it('restores the remembered position when switching scopes', async () => {
    const calls: any[][] = []
    const browse = vi.fn()
    await act(async () => {
      root.render(
        <PromptLibrarySettingsPanel
          controller={createController(calls)}
          workspaces={[{ id: 'ws-1', name: '甲工作区' }, { id: 'ws-2', name: '乙工作区' }]}
          browseState={{ workspace: { ownerId: 'ws-2', folderId: 'f9' } }}
          onBrowseStateChange={browse}
        />,
      )
    })

    await switchScope('工作区提示词')

    expect(calls).toContainEqual(['library', 'workspace', 'ws-2'])
    expect(browse).toHaveBeenCalledWith('workspace', expect.objectContaining({ ownerId: 'ws-2', folderId: 'f9' }))
  })
})
