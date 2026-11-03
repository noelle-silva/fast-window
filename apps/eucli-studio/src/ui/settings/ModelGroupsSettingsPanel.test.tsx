// @vitest-environment happy-dom
//
// 模型组列表刷新回归：
// controller 对 modelGroups.items 就地新增时数组引用不变。
// 模型组列表由 id 清单驱动渲染，id 清单必须每次从当前数组直接派生，
// 不能以数组引用作为 useMemo 的失效依据，否则新建模型组后列表会停留在旧结果。
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ModelGroupsSettingsPanel } from './ModelGroupsSettingsPanel'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

function createController() {
  return {
    actions: {
      refreshModelGroups: () => {},
      createModelGroup: () => '',
      saveModelGroups: () => {},
      moveModelGroup: () => {},
    },
  } as any
}

describe('模型组设置面板列表刷新', () => {
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

  function renderPanel(items: any[], controller: any) {
    act(() => {
      root.render(
        <ModelGroupsSettingsPanel
          controller={controller}
          loading={false}
          modelGroups={{ items }}
          providers={[]}
        />,
      )
    })
  }

  it('同一 items 数组就地新增模型组后，重渲染立即显示新模型组', () => {
    const controller = createController()
    const items: any[] = [{ id: 'mg1', name: '模型组甲', models: [] }]

    renderPanel(items, controller)
    expect(host!.textContent).toContain('模型组甲')

    act(() => {
      items.push({ id: 'mg2', name: '模型组乙', models: [] })
    })
    renderPanel(items, controller)

    expect(host!.textContent).toContain('模型组甲')
    expect(host!.textContent).toContain('模型组乙')
  })
})
