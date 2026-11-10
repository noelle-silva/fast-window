// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PromptLibrarySettingsPanel } from './PromptLibrarySettingsPanel'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const PROMPTS = [
  { id: 'p1', name: '甲', content: '甲正文', description: '', createdAt: '', updatedAt: '' },
  { id: 'p2', name: '乙', content: '乙正文', description: '', createdAt: '', updatedAt: '' },
]

function createController() {
  return {
    actions: {
      loadPromptLibrary: async () => ({ prompts: PROMPTS }),
      loadPromptFolders: async () => ({ rootFolderIds: [], rootEntryOrder: [], folders: [] }),
    },
  }
}

describe('提示词库重开窗口', () => {
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

  async function renderPanel(browseState: any) {
    await act(async () => {
      root.render(
        <PromptLibrarySettingsPanel
          controller={createController()}
          roles={[{ id: 'role-1', name: '甲角色' }]}
          initialScope="role"
          initialOwnerId="role-1"
          browseState={browseState}
        />,
      )
    })
  }

  it('重开时回到上次打开的那条提示词，不用再手动点一次', async () => {
    await renderPanel({ role: { ownerId: 'role-1', folderId: '', selectedPromptId: 'p2' } })
    // 编辑器已经打开「乙」这一条，名称输入框就是它的名字。
    const inputs = Array.from(host!.querySelectorAll('input')) as HTMLInputElement[]
    expect(inputs.some((el) => el.value === '乙')).toBe(true)
    // 正文区跟着这一条一起打开。
    expect(host!.textContent).toContain('内容')
  })

  it('没记住选中项时保持空白，不会自己挑一条', async () => {
    await renderPanel({ role: { ownerId: 'role-1', folderId: '' } })
    const inputs = Array.from(host!.querySelectorAll('input')) as HTMLInputElement[]
    expect(inputs.some((el) => el.value === '乙')).toBe(false)
    expect(host!.textContent).toContain('选择左侧的提示词查看与编辑')
  })
})
