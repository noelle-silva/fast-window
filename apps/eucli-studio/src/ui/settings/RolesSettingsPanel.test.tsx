// @vitest-environment happy-dom
//
// 角色列表刷新回归：
// controller 对 roles 数组就地新增 / 改名时数组引用不变。
// 面板列表必须直接读取当前数组，不能以数组引用作为缓存依据，
// 否则新建 / 改名后列表会停留在旧结果。
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RolesSettingsPanel } from './RolesSettingsPanel'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

function createController() {
  return {
    actions: {
      createRoleInPlace: () => {},
      saveRole: () => {},
      openRoleEditorInPlace: () => {},
      moveRole: () => {},
    },
  } as any
}

describe('角色设置面板列表刷新', () => {
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

  function renderPanel(roles: any[], controller: any) {
    act(() => {
      root.render(
        <RolesSettingsPanel
          controller={controller}
          loading={false}
          roles={roles}
          providers={[]}
          modelGroups={[]}
          models={null}
          tools={null}
          hookPrompts={null}
          placeholders={null}
          draft={{}}
          activeRoleId=""
        />,
      )
    })
  }

  it('同一 roles 数组就地新增角色后，重渲染立即显示新角色', () => {
    const controller = createController()
    const roles: any[] = [{ id: 'r1', name: '角色甲' }]

    renderPanel(roles, controller)
    expect(host!.textContent).toContain('角色甲')

    act(() => {
      roles.push({ id: 'r2', name: '角色乙' })
    })
    renderPanel(roles, controller)

    expect(host!.textContent).toContain('角色甲')
    expect(host!.textContent).toContain('角色乙')
  })

  it('同一角色对象就地改名后，重渲染立即显示新名称', () => {
    const controller = createController()
    const role = { id: 'r1', name: '旧角色名' }
    const roles: any[] = [role]

    renderPanel(roles, controller)
    expect(host!.textContent).toContain('旧角色名')

    act(() => {
      role.name = '新角色名'
    })
    renderPanel(roles, controller)

    expect(host!.textContent).toContain('新角色名')
    expect(host!.textContent).not.toContain('旧角色名')
  })
})
