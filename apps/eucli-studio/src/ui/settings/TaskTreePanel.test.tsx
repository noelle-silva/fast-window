// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TaskTreePanel } from './TaskTreePanel'
import type { TaskNode, TaskTree } from '../../domain/taskTree'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

function node(id: string, name: string, children: TaskNode[] = []): TaskNode {
  return {
    id,
    name,
    description: '',
    content: '',
    copyHighlight: false,
    status: 'todo',
    children,
    createdAt: '',
    updatedAt: '',
  }
}

const ROLE_TREE: TaskTree = { tasks: [node('a', '甲', [node('a1', '甲一')]), node('b', '乙')] }
const WORKSPACE_TREE: TaskTree = { tasks: [node('w1', '工作区任务')] }

function createController(calls: any[][], trees: { role?: TaskTree; workspace?: TaskTree } = {}) {
  return {
    actions: {
      loadTaskTree: async (scope: string, ownerId: string) => {
        calls.push(['load', scope, ownerId])
        if (scope === 'workspace') return trees.workspace ?? WORKSPACE_TREE
        return trees.role ?? ROLE_TREE
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

  it('打开复制高亮开关后保存，卡片带上的标记会写回整棵树', async () => {
    const calls: any[][] = []
    await act(async () => {
      root.render(<TaskTreePanel controller={createController(calls)} roles={[{ id: 'r1', name: '角色一' }]} />)
    })

    const cardTitle = Array.from(host!.querySelectorAll('p')).find((element) => element.textContent === '甲')
    await act(async () => {
      click(cardTitle || null)
    })

    const highlightSwitch = host!.querySelector('input[aria-label="复制键高亮"]')
    expect(highlightSwitch).toBeTruthy()
    await act(async () => {
      click(highlightSwitch)
    })

    const saveButton = findButton(host!, '保存')
    await act(async () => {
      click(saveButton)
    })

    const saveCall = calls.find((call) => call[0] === 'save')
    expect(saveCall?.[3].tasks[0].copyHighlight).toBe(true)
    expect(saveCall?.[3].tasks[1].copyHighlight).toBe(false)
  })

  it('归档任务不进卡片墙，其它状态照常出卡并带进度标签', async () => {
    const calls: any[][] = []
    const trees = {
      role: {
        tasks: [
          { ...node('a', '甲'), status: 'archived' as const },
          { ...node('b', '乙'), status: 'doing' as const },
        ],
      },
    }
    await act(async () => {
      root.render(<TaskTreePanel controller={createController(calls, trees)} roles={[{ id: 'r1', name: '角色一' }]} />)
    })

    expect(host!.textContent).not.toContain('甲')
    expect(host!.textContent).toContain('乙')
    // 卡片右下角的进度标签用的是状态中文名。
    expect(host!.textContent).toContain('进行中')
  })

  it('状态切换按钮改的是草稿，保存时把状态写回整棵树', async () => {
    const calls: any[][] = []
    await act(async () => {
      root.render(<TaskTreePanel controller={createController(calls)} roles={[{ id: 'r1', name: '角色一' }]} />)
    })

    const cardTitle = Array.from(host!.querySelectorAll('p')).find((element) => element.textContent === '甲')
    await act(async () => {
      click(cardTitle || null)
    })

    const nextButton = findButton(host!, '下一个状态')
    expect(nextButton).toBeTruthy()
    await act(async () => {
      click(nextButton)
    })
    expect(host!.textContent).toContain('进行中')

    const saveButton = findButton(host!, '保存')
    await act(async () => {
      click(saveButton)
    })

    const saveCall = calls.find((call) => call[0] === 'save')
    expect(saveCall?.[3].tasks[0].status).toBe('doing')
    expect(saveCall?.[3].tasks[1].status).toBe('todo')
  })

  it('顶部栏左侧进归档页，归档卡片点开能在左栏恢复成别的状态', async () => {
    const calls: any[][] = []
    const trees = {
      role: {
        tasks: [
          { ...node('a', '甲'), status: 'archived' as const },
          { ...node('b', '乙'), status: 'doing' as const },
        ],
      },
    }
    await act(async () => {
      root.render(<TaskTreePanel controller={createController(calls, trees)} roles={[{ id: 'r1', name: '角色一' }]} />)
    })

    // 正常视图里归档任务不出卡片。
    expect(host!.textContent).not.toContain('甲')

    const archiveButton = findButton(host!, '归档')
    expect(archiveButton).toBeTruthy()
    await act(async () => {
      click(archiveButton)
    })

    expect(host!.textContent).toContain('归档任务')
    expect(host!.textContent).toContain('甲')

    const cardTitle = Array.from(host!.querySelectorAll('p')).find((element) => element.textContent === '甲')
    await act(async () => {
      click(cardTitle || null)
    })

    // 归档页里的状态是三个并排按钮，点哪个就恢复成哪个。
    const doneButton = findButton(host!, '已完成')
    expect(doneButton).toBeTruthy()
    await act(async () => {
      click(doneButton)
    })

    const saveButton = findButton(host!, '保存')
    await act(async () => {
      click(saveButton)
    })

    const saveCall = calls.find((call) => call[0] === 'save')
    expect(saveCall?.[3].tasks[0].status).toBe('done')
  })

  it('更多菜单里的归档要二次确认，确认后直接落库并从卡片墙消失', async () => {
    const calls: any[][] = []
    await act(async () => {
      root.render(<TaskTreePanel controller={createController(calls)} roles={[{ id: 'r1', name: '角色一' }]} />)
    })

    const menuButton = Array.from(host!.querySelectorAll('button')).find(
      (button) => button.getAttribute('aria-label') === '任务操作',
    )
    expect(menuButton).toBeTruthy()
    await act(async () => {
      click(menuButton || null)
    })

    const archiveItem = Array.from(document.querySelectorAll('li')).find((item) =>
      String(item.textContent).includes('归档'),
    )
    expect(archiveItem).toBeTruthy()
    await act(async () => {
      click(archiveItem || null)
    })

    // 先弹二次确认，确认之前不发请求。
    expect(document.body.textContent).toContain('归档「甲」？')
    expect(calls.some((call) => call[0] === 'save')).toBe(false)

    const confirmButton = Array.from(document.querySelectorAll('button')).find(
      (button) => !host!.contains(button) && String(button.textContent).trim() === '归档',
    )
    expect(confirmButton).toBeTruthy()
    await act(async () => {
      click(confirmButton || null)
    })

    const saveCall = calls.find((call) => call[0] === 'save')
    expect(saveCall?.[3].tasks[0].status).toBe('archived')
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
