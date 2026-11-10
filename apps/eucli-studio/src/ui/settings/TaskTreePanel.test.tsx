// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TaskTreePanel } from './TaskTreePanel'
import type { TaskNode, TaskTree } from '../../domain/taskTree'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

function node(id: string, name: string, children: TaskNode[] = []): TaskNode {
  return { id, name, description: '', content: '', children, createdAt: '', updatedAt: '' }
}

const ROLE_TREE: TaskTree = { tasks: [node('a', '甲', [node('a1', '甲一')]), node('b', '乙')] }
const WORKSPACE_TREE: TaskTree = { tasks: [node('w1', '工作区任务')] }

function createController(calls: any[][]) {
  return {
    actions: {
      loadTaskTree: async (scope: string, ownerId: string) => {
        calls.push(['load', scope, ownerId])
        return scope === 'workspace' ? WORKSPACE_TREE : ROLE_TREE
      },
      saveTaskTree: async (scope: string, ownerId: string, tree: TaskTree) => {
        calls.push(['save', scope, ownerId, tree])
        return tree
      },
      createTaskNode: async (scope: string, ownerId: string, parentId: string) => {
        calls.push(['create', scope, ownerId, parentId])
        return ROLE_TREE
      },
      deleteTaskNode: async () => ROLE_TREE,
      moveTaskNode: async () => ROLE_TREE,
      reorderTaskChildren: async () => ROLE_TREE,
      notifyTaskTree: () => {},
    },
  }
}

// 按钮既有纯文字的（切换栏），也有只留图标的（返回 / 新建 / 保存 / 复制 / 移动），
// 所以文案与 aria-label 都算命中。
function findButton(host: HTMLElement, label: string) {
  return (
    Array.from(host.querySelectorAll('button')).find(
      (button) =>
        String(button.textContent || '').includes(label) ||
        String(button.getAttribute('aria-label') || '').includes(label),
    ) || null
  )
}

function click(element: Element | null) {
  if (!element) throw new Error('element not found')
  element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

describe('任务面板', () => {
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

  it('默认按角色读树并把根层画成卡片', async () => {
    const calls: any[][] = []
    await act(async () => {
      root.render(<TaskTreePanel controller={createController(calls)} roles={[{ id: 'r1', name: '角色一' }]} />)
    })

    expect(calls).toContainEqual(['load', 'role', 'r1'])
    expect(host!.textContent).toContain('甲')
    expect(host!.textContent).toContain('乙')
    // 根层没有当前节点，左栏不出现。
    expect(host!.textContent).not.toContain('可复制文本')
  })

  it('按请求的作用域与归属打开', async () => {
    const calls: any[][] = []
    await act(async () => {
      root.render(
        <TaskTreePanel
          controller={createController(calls)}
          workspaces={[{ id: 'w1', name: '工作区一' }]}
          initialScope="workspace"
          initialOwnerId="w1"
        />,
      )
    })

    expect(calls).toContainEqual(['load', 'workspace', 'w1'])
    expect(host!.textContent).toContain('工作区任务')
  })

  it('进入卡片后左栏就是该节点的编辑位，保存把改动写回整棵树', async () => {
    const calls: any[][] = []
    await act(async () => {
      root.render(<TaskTreePanel controller={createController(calls)} roles={[{ id: 'r1', name: '角色一' }]} />)
    })

    const cardTitle = Array.from(host!.querySelectorAll('p')).find((element) => element.textContent === '甲')
    await act(async () => {
      click(cardTitle || null)
    })

    expect(host!.textContent).toContain('可复制文本')
    // 进了「甲」这一层，面包屑与左栏都指向它，右侧是它的子节点。
    expect(host!.textContent).toContain('甲一')

    const nameInput = Array.from(host!.querySelectorAll('input')).find((input) => input.value === '甲') as HTMLInputElement | undefined
    expect(nameInput).toBeTruthy()

    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    await act(async () => {
      setter?.call(nameInput, '甲改')
      nameInput!.dispatchEvent(new Event('input', { bubbles: true }))
    })

    const saveButton = findButton(host!, '保存')
    await act(async () => {
      click(saveButton)
    })

    const saveCall = calls.find((call) => call[0] === 'save')
    expect(saveCall?.[3].tasks[0].name).toBe('甲改')
    // 兄弟节点不受影响。
    expect(saveCall?.[3].tasks[1].name).toBe('乙')
  })

  it('新建任务在根层时以空父级提交', async () => {
    const calls: any[][] = []
    await act(async () => {
      root.render(<TaskTreePanel controller={createController(calls)} roles={[{ id: 'r1', name: '角色一' }]} />)
    })

    const createButton = findButton(host!, '新建任务')
    await act(async () => {
      click(createButton)
    })

    const createCall = calls.find((call) => call[0] === 'create')
    expect(createCall?.[3]).toBe('')
  })
})
