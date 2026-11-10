import { describe, expect, it } from 'vitest'
import {
  applyTaskDraft,
  moveTaskInLayer,
  normalizeTaskTree,
  resolveTaskPath,
  taskById,
  taskDraftIsDirty,
  taskLabel,
  taskLayerNodes,
  taskParentOptions,
  taskSiblingLayer,
  taskSubtreeIds,
  UNNAMED_TASK_LABEL,
  type TaskNode,
} from './taskTree'

function node(id: string, children: TaskNode[] = [], name = ''): TaskNode {
  return { id, name, description: '', content: '', children, createdAt: '', updatedAt: '' }
}

const TREE = normalizeTaskTree({
  tasks: [
    { id: 'a', name: '甲', children: [{ id: 'a1', name: '甲一', children: [{ id: 'a1x' }] }, { id: 'a2', name: '甲二' }] },
    { id: 'b', name: '乙' },
  ],
})

describe('normalizeTaskTree', () => {
  it('fills defaults and always exposes children as an array', () => {
    const tree = normalizeTaskTree({ tasks: [{ id: 'a', name: 123, children: null }] })
    expect(tree.tasks[0]).toMatchObject({ id: 'a', name: '123', description: '', content: '', createdAt: '' })
    expect(tree.tasks[0].children).toEqual([])
  })

  it('returns an empty tree for junk input', () => {
    expect(normalizeTaskTree(undefined).tasks).toEqual([])
    expect(normalizeTaskTree({ tasks: 'nope' }).tasks).toEqual([])
  })

  it('falls back to a readable label when the name is empty', () => {
    expect(taskLabel(node('x'))).toBe(UNNAMED_TASK_LABEL)
    expect(taskLabel(node('x', [], '有名字'))).toBe('有名字')
  })
})

describe('resolveTaskPath', () => {
  it('walks down by id', () => {
    expect(resolveTaskPath(TREE, ['a', 'a1']).map((item) => item.id)).toEqual(['a', 'a1'])
  })

  it('truncates at the first missing segment instead of failing', () => {
    expect(resolveTaskPath(TREE, ['a', 'ghost', 'a1x']).map((item) => item.id)).toEqual(['a'])
  })

  it('switches layer by the resolved path', () => {
    const path = resolveTaskPath(TREE, ['a', 'a1'])
    expect(taskLayerNodes(TREE, path).map((item) => item.id)).toEqual(['a1x'])
    expect(taskLayerNodes(TREE, []).map((item) => item.id)).toEqual(['a', 'b'])
  })
})

describe('tree lookups', () => {
  it('finds a node anywhere', () => {
    expect(taskById(TREE, 'a1x')?.id).toBe('a1x')
    expect(taskById(TREE, 'ghost')).toBeNull()
  })

  it('reports the sibling layer and its parent', () => {
    expect(taskSiblingLayer(TREE, 'a2')).toEqual({ parentId: 'a', ids: ['a1', 'a2'] })
    expect(taskSiblingLayer(TREE, 'b')).toEqual({ parentId: '', ids: ['a', 'b'] })
    expect(taskSiblingLayer(TREE, 'ghost')).toBeNull()
  })

  it('collects a whole subtree', () => {
    expect(taskSubtreeIds(TREE.tasks[0])).toEqual(['a', 'a1', 'a1x', 'a2'])
  })
})

describe('moveTaskInLayer', () => {
  it('moves one step and refuses to leave the layer', () => {
    expect(moveTaskInLayer(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c'])
    expect(moveTaskInLayer(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b'])
    expect(moveTaskInLayer(['a', 'b'], 'a', -1)).toEqual(['a', 'b'])
    expect(moveTaskInLayer(['a', 'b'], 'b', 1)).toEqual(['a', 'b'])
  })
})

describe('taskParentOptions', () => {
  it('drops the excluded subtree and keeps depth', () => {
    const options = taskParentOptions(TREE, new Set(taskSubtreeIds(TREE.tasks[0])))
    expect(options).toEqual([{ id: 'b', label: '乙', depth: 1 }])
  })

  it('lists everything when nothing is excluded', () => {
    expect(taskParentOptions(TREE, new Set()).map((item) => `${item.depth}:${item.id}`)).toEqual([
      '1:a',
      '2:a1',
      '3:a1x',
      '2:a2',
      '1:b',
    ])
  })
})

describe('draft', () => {
  it('only rewrites the target node', () => {
    const next = applyTaskDraft(TREE, { id: 'a1', name: '改过', description: '备注', content: '正文' })
    expect(next.tasks[0].children[0]).toMatchObject({ id: 'a1', name: '改过', description: '备注', content: '正文' })
    // 同层的兄弟与上一级都不跟着变。
    expect(next.tasks[0].children[1]).toMatchObject({ id: 'a2', name: '甲二' })
    expect(next.tasks[1].name).toBe('乙')
  })

  it('reports dirty only for real field changes', () => {
    const current = node('a', [], '甲')
    expect(taskDraftIsDirty(current, { id: 'a', name: '甲', description: '', content: '' })).toBe(false)
    expect(taskDraftIsDirty(current, { id: 'a', name: '甲 ', description: '', content: '' })).toBe(true)
    expect(taskDraftIsDirty(current, { id: 'other', name: '甲', description: '', content: '' })).toBe(false)
    expect(taskDraftIsDirty(null, null)).toBe(false)
  })
})
