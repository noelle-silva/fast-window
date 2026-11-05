// @vitest-environment happy-dom
//
// 角色信息里的角色 ID 行：
// 已有角色显示真实 ID 并可一键复制；新建角色没有 ID，按钮禁用并提示保存后生成。
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RoleIdentitySection } from './RoleIdentitySection'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

function createController(writeText: (text: string) => Promise<void>) {
  return {
    actions: {},
    capabilities: {
      clipboard: { writeText },
      ui: { showToast: vi.fn() },
    },
  } as any
}

describe('角色信息：角色 ID', () => {
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

  function renderSection(controller: any, draft: any) {
    act(() => {
      root.render(<RoleIdentitySection controller={controller} draft={draft} />)
    })
  }

  function copyButton() {
    const found = host!.querySelector('button[aria-label="复制角色 ID"]') as HTMLButtonElement | null
    if (!found) throw new Error('没有找到复制按钮')
    return found
  }

  it('已有角色显示 ID，点击复制把 ID 写进剪贴板', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    const controller = createController(writeText)
    renderSection(controller, { editRoleId: 'role-1a2b', roleName: '晶晶' })

    expect(host!.textContent).toContain('role-1a2b')
    expect(copyButton().disabled).toBe(false)

    await act(async () => {
      copyButton().click()
    })

    expect(writeText).toHaveBeenCalledWith('role-1a2b')
    expect(controller.capabilities.ui.showToast).toHaveBeenCalledWith('已复制角色 ID', { kind: 'success' })
  })

  it('新建角色没有 ID：提示保存后生成，复制按钮禁用', () => {
    const writeText = vi.fn(() => Promise.resolve())
    const controller = createController(writeText)
    renderSection(controller, { editRoleId: '__new__', roleName: '' })

    expect(host!.textContent).toContain('保存角色后生成')
    expect(copyButton().disabled).toBe(true)
  })
})
