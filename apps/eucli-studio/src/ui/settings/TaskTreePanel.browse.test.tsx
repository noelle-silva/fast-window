// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TaskTreePanel } from './TaskTreePanel'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const TREE = {
  tasks: [
    {
      id: 'n1',
      name: '甲任务',
      description: '',
      content: '',
      children: [],
      createdAt: '',
      updatedAt: '',
    },
  ],
}

function createController() {
  return {
    actions: {
      loadTaskTree: async () => TREE,
      notifyTaskTree: () => {},
    },
  }
}

describe('任务面板的浏览位置记忆', () => {
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

  async function renderPanel(browseState: any, reports: any[]) {
    await act(async () => {
      root.render(
        <TaskTreePanel
          controller={createController()}
          roles={[{ id: 'role-1', name: '甲角色' }]}
          initialScope="role"
          lockedScope="role"
          initialOwnerId="role-1"
          browseState={browseState}
          onBrowseStateChange={(scope, state) => reports.push({ scope, state })}
        />,
      )
    })
  }

  it('重开窗口回到记忆里的那条路径，而不是被打回根层', async () => {
    const reports: any[] = []
    await renderPanel({ role: { ownerId: 'role-1', pathIds: ['n1'] } }, reports)

    // 停在第 n1 层：面包屑与编辑器都在说这件事。
    expect(host!.textContent).toContain('甲任务')
    const inputs = Array.from(host!.querySelectorAll('input')) as HTMLInputElement[]
    expect(inputs.some((el) => el.value === '甲任务')).toBe(true)

    // 上报出去的路径也还是记忆里那条，没有被清空。
    expect(reports.length).toBeGreaterThan(0)
    expect(reports[reports.length - 1].state.pathIds).toEqual(['n1'])
  })

  it('记忆里的路径已经不存在时，退回根层而不是卡在空路径', async () => {
    const reports: any[] = []
    await renderPanel({ role: { ownerId: 'role-1', pathIds: ['gone'] } }, reports)

    // 解析不出这一层，按根层显示。
    expect(reports[reports.length - 1].state.pathIds).toEqual([])
  })
})
