// @vitest-environment happy-dom
//
// 角色编辑分类切换：
// 切换栏只负责切换可见面板，非当前分类保持挂载，
// 这样输入框、预览与依赖树等本地状态不会因为来回切分类被清掉。
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RoleEditorForm } from './RoleEditorForm'
import { roleEditorPanelDomId, type RoleEditorCategoryId } from './roleEditorCategories'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const controller = { actions: {} } as any

describe('角色编辑分类切换', () => {
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

  function renderForm(defaultCategory?: RoleEditorCategoryId) {
    act(() => {
      root.render(
        <RoleEditorForm
          controller={controller}
          providers={[]}
          modelGroups={[]}
          draft={{ roleName: '晶晶', roleSystemPrompt: '保持耐心' }}
          models={null}
          tools={null}
          defaultCategory={defaultCategory}
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

  function panel(categoryId: RoleEditorCategoryId) {
    return host!.querySelector(`#${roleEditorPanelDomId(categoryId)}`) as HTMLElement | null
  }

  function panelHidden(categoryId: RoleEditorCategoryId) {
    const node = panel(categoryId)
    return !node || node.hasAttribute('hidden')
  }

  it('默认落在模型配置，其它分类面板隐藏', () => {
    renderForm()
    expect(tab('模型配置').getAttribute('aria-selected')).toBe('true')
    expect(panelHidden('model')).toBe(false)
    expect(panelHidden('prompt')).toBe(true)
    expect(panelHidden('tools')).toBe(true)
    expect(panelHidden('other')).toBe(true)
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
    expect(topBranch(tablist!)).not.toBe(topBranch(panel('model')!))
  })

  it('点击切换栏只换可见面板，其余分类保持挂载', () => {
    renderForm()
    act(() => tab('工具配置').click())
    expect(tab('工具配置').getAttribute('aria-selected')).toBe('true')
    expect(panelHidden('tools')).toBe(false)
    expect(panelHidden('model')).toBe(true)

    act(() => tab('提示词编辑').click())
    expect(panelHidden('prompt')).toBe(false)
    expect(String(panel('prompt')?.textContent || '')).toContain('系统提示词')
  })

  it('新建角色可以默认落在其他配置', () => {
    renderForm('other')
    expect(tab('其他配置').getAttribute('aria-selected')).toBe('true')
    expect(panelHidden('other')).toBe(false)
  })
})
