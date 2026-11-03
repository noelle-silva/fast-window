// @vitest-environment happy-dom
//
// 群组列表刷新回归：
// controller 对 groups 数组就地新增时数组引用不变。
// 面板列表必须直接读取当前数组，不能以数组引用作为缓存依据，
// 否则新建群组后列表会停留在旧结果。
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GroupsSettingsPanel } from './GroupsSettingsPanel'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

function createController() {
  return {
    actions: {
      createGroupInPlace: () => {},
      saveGroup: () => {},
      openGroupEditorInPlace: () => {},
      moveGroup: () => {},
    },
  } as any
}

describe('群组设置面板列表刷新', () => {
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

  function renderPanel(groups: any[], controller: any) {
    act(() => {
      root.render(
        <GroupsSettingsPanel
          controller={controller}
          loading={false}
          groups={groups}
          roles={[]}
          draft={{}}
          activeGroupId=""
          activeTargetKind=""
        />,
      )
    })
  }

  it('同一 groups 数组就地新增群组后，重渲染立即显示新群组', () => {
    const controller = createController()
    const groups: any[] = [{ id: 'g1', name: '群组甲', memberRoleIds: [] }]

    renderPanel(groups, controller)
    expect(host!.textContent).toContain('群组甲')

    act(() => {
      groups.push({ id: 'g2', name: '群组乙', memberRoleIds: [] })
    })
    renderPanel(groups, controller)

    expect(host!.textContent).toContain('群组甲')
    expect(host!.textContent).toContain('群组乙')
  })
})
