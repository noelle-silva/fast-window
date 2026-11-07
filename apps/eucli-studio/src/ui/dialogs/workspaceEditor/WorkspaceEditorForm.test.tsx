// @vitest-environment happy-dom
//
// 工作区编辑分类切换：
// 与角色编辑同一套布局契约——切换栏固定、面板各自滚动、
// 非当前分类只隐藏不卸载，切换分类不会清掉输入框等本地状态。
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceEditorForm } from './WorkspaceEditorForm'
import { workspaceEditorPanelDomId, type WorkspaceEditorCategoryId } from './workspaceEditorCategories'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

describe('工作区编辑分类切换', () => {
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

  function renderForm(actions: Record<string, any> = {}) {
    act(() => {
      root.render(
        <WorkspaceEditorForm
          controller={{ actions }}
          draft={{ workspaceName: '主工程', workspacePrompt: '遵守项目规范' }}
          roles={[]}
        />,
      )
    })
  }

  function tab(label: string) {
    const found = Array.from(host!.querySelectorAll('[role="tab"]')).find((node) =>
      String(node.textContent || '').includes(label),
    )
    if (!found) throw new Error(`没有找到分类：${label}`)
    return found as HTMLElement
  }

  function button(label: string) {
    const found = Array.from(host!.querySelectorAll('button')).find((node) =>
      String(node.textContent || '').includes(label),
    )
    if (!found) throw new Error(`没有找到按钮：${label}`)
    return found as HTMLElement
  }

  function panel(categoryId: WorkspaceEditorCategoryId) {
    return host!.querySelector(`#${workspaceEditorPanelDomId(categoryId)}`) as HTMLElement | null
  }

  function panelHidden(categoryId: WorkspaceEditorCategoryId) {
    const node = panel(categoryId)
    return !node || node.hasAttribute('hidden')
  }

  it('默认落在基本信息，其它分类面板隐藏', () => {
    renderForm()
    expect(tab('基本信息').getAttribute('aria-selected')).toBe('true')
    expect(panelHidden('identity')).toBe(false)
    expect(panelHidden('directories')).toBe(true)
    expect(panelHidden('prompt')).toBe(true)
    expect(panelHidden('roles')).toBe(true)
  })

  it('目录清单排在第二格', () => {
    renderForm()
    const labels = Array.from(host!.querySelectorAll('[role="tab"]')).map((node) => String(node.textContent || '').trim())
    expect(labels.slice(0, 2)).toEqual(['基本信息', '目录清单'])
  })

  // 切换栏必须和面板分处两个维护分支：一旦被包进同一个滚动容器，切换栏就会跟着内容滚走。
  function topBranch(node: Element) {
    const formRoot = host!.firstElementChild
    let current: Element | null = node
    while (current && current.parentElement !== formRoot) current = current.parentElement
    return current
  }

  it('切换栏不在面板的滚动分支里', () => {
    renderForm()
    const tablist = host!.querySelector('[role="tablist"]')
    expect(tablist).toBeTruthy()
    expect(topBranch(tablist!)).toBeTruthy()
    expect(topBranch(tablist!)).not.toBe(topBranch(panel('identity')!))
  })

  it('点击切换栏只换可见面板，其余分类保持挂载', () => {
    renderForm()
    act(() => tab('目录清单').click())
    expect(tab('目录清单').getAttribute('aria-selected')).toBe('true')
    expect(panelHidden('directories')).toBe(false)
    expect(panelHidden('identity')).toBe(true)

    act(() => tab('提示词').click())
    expect(panelHidden('prompt')).toBe(false)
    expect(String(panel('prompt')?.textContent || '')).toContain('工作区提示词')
  })

  // 实际提示词没有手动刷新按钮：打开预览就该自动生成一次。
  it('打开实际提示词预览会自动生成，不依赖手动刷新', async () => {
    const refreshWorkspacePromptPreview = vi.fn()
    renderForm({ refreshWorkspacePromptPreview })

    act(() => tab('提示词').click())
    act(() => button('实际提示词').click())
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 320))
    })

    expect(refreshWorkspacePromptPreview).toHaveBeenCalledTimes(1)
    expect(Array.from(host!.querySelectorAll('button')).some((node) => String(node.textContent || '').trim() === '刷新')).toBe(false)
  })
})
