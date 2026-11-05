// @vitest-environment happy-dom
//
// 工作区列表刷新回归：
// controller 对 workspaces 数组就地新增时数组引用不变。
// 面板列表必须直接读取当前数组，不能以数组引用作为缓存依据，
// 否则新建工作区后列表会停留在旧结果。
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WorkspacesSettingsPanel } from './WorkspacesSettingsPanel'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

function createController() {
  return {
    actions: {
      createWorkspaceInPlace: () => {},
      saveWorkspace: () => {},
      openWorkspaceEditorInPlace: () => {},
      moveWorkspace: () => {},
    },
  } as any
}

describe('工作区设置面板列表刷新', () => {
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

  function renderPanel(workspaces: any[], controller: any) {
    act(() => {
      root.render(
        <WorkspacesSettingsPanel
          controller={controller}
          loading={false}
          workspaces={workspaces}
          roles={[]}
          draft={{}}
          activeWorkspaceId=""
          activeTargetKind=""
        />,
      )
    })
  }

  it('同一 workspaces 数组就地新增工作区后，重渲染立即显示新工作区', () => {
    const controller = createController()
    const workspaces: any[] = [{ id: 'w1', name: '工作区甲', directories: [] }]

    renderPanel(workspaces, controller)
    expect(host!.textContent).toContain('工作区甲')

    act(() => {
      workspaces.push({ id: 'w2', name: '工作区乙', directories: [] })
    })
    renderPanel(workspaces, controller)

    expect(host!.textContent).toContain('工作区甲')
    expect(host!.textContent).toContain('工作区乙')
  })

  it('目录健康状态为失效时，列表如实显示失效数量', () => {
    const controller = createController()
    const workspaces: any[] = [{
      id: 'w1',
      name: '工作区甲',
      directories: [
        { path: 'E:/project', alias: '可用', description: '', health: { status: 'available' } },
        { path: 'E:/moved', alias: '已移动', description: '', health: { status: 'missing' } },
      ],
    }]

    renderPanel(workspaces, controller)
    expect(host!.textContent).toContain('2 个目录 · 1 个失效')
  })
})
