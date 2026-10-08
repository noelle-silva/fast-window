import { describe, expect, it } from 'vitest'
import { buildGlobalRelationGraph, maxDegreeOf, nodeRadiusForDegree } from './globalRelationGraph'
import type { NoteMeta } from './core'
import type { NoteRefIndex } from './noteRefs'

function note(id: string, title = id): NoteMeta {
  return { id, title, description: '', dir: '', createdAtMs: 0, updatedAtMs: 0 }
}

describe('buildGlobalRelationGraph', () => {
  it('把笔记索引中的全部笔记作为节点，包含没有任何引用的孤立笔记', () => {
    const graph = buildGlobalRelationGraph([note('a'), note('b'), note('c')], {})
    expect(graph.nodes.map(node => node.id)).toEqual(['a', 'b', 'c'])
    expect(graph.edges).toEqual([])
    expect(graph.nodes.every(node => node.degree === 0)).toBe(true)
  })

  it('把引用索引展开为无向边并按笔记对去重，同时记录双向引用', () => {
    const refIndex: NoteRefIndex = {
      a: { f1: [{ noteId: 'b' }], f2: [{ noteId: 'b' }] },
      b: { f1: [{ noteId: 'a' }] },
    }
    const graph = buildGlobalRelationGraph([note('a'), note('b')], refIndex)
    expect(graph.edges).toEqual([{ source: 'a', target: 'b', sourceToTarget: true, targetToSource: true }])
    expect(graph.nodes.find(node => node.id === 'a')?.degree).toBe(1)
    expect(graph.nodes.find(node => node.id === 'b')?.degree).toBe(1)
  })

  it('单向引用只在被引用端标记方向', () => {
    const graph = buildGlobalRelationGraph([note('a'), note('b')], { a: { f1: [{ noteId: 'b' }] } })
    expect(graph.edges).toEqual([{ source: 'a', target: 'b', sourceToTarget: true, targetToSource: false }])
  })

  it('反向单向引用同样被识别并指向被引用方', () => {
    const graph = buildGlobalRelationGraph([note('a'), note('b')], { b: { f1: [{ noteId: 'a' }] } })
    expect(graph.edges).toEqual([{ source: 'b', target: 'a', sourceToTarget: true, targetToSource: false }])
  })

  it('忽略自引用与指向不存在笔记的引用', () => {
    const refIndex: NoteRefIndex = { a: { f1: [{ noteId: 'a' }, { noteId: 'ghost' }, { noteId: 'b' }] } }
    const graph = buildGlobalRelationGraph([note('a'), note('b')], refIndex)
    expect(graph.edges).toEqual([{ source: 'a', target: 'b', sourceToTarget: true, targetToSource: false }])
  })

  it('连接数按邻居数量统计并决定节点大小', () => {
    const refIndex: NoteRefIndex = {
      a: { f1: [{ noteId: 'b' }, { noteId: 'c' }] },
      b: { f1: [{ noteId: 'c' }] },
    }
    const graph = buildGlobalRelationGraph([note('a'), note('b'), note('c'), note('d')], refIndex)
    const degreeOf = (id: string) => graph.nodes.find(node => node.id === id)?.degree
    expect(degreeOf('a')).toBe(2)
    expect(degreeOf('b')).toBe(2)
    expect(degreeOf('c')).toBe(2)
    expect(degreeOf('d')).toBe(0)
    expect(maxDegreeOf(graph)).toBe(2)
    expect(nodeRadiusForDegree(0, 2, 7, 13)).toBeLessThan(nodeRadiusForDegree(2, 2, 7, 13))
  })

  it('没有笔记或引用索引时返回空图', () => {
    expect(buildGlobalRelationGraph(null, null)).toEqual({ nodes: [], edges: [] })
    expect(buildGlobalRelationGraph([], null)).toEqual({ nodes: [], edges: [] })
  })
})

describe('nodeRadiusForDegree', () => {
  it('孤立笔记取最小值，满连接取最大值', () => {
    expect(nodeRadiusForDegree(0, 5, 7, 13)).toBe(7)
    expect(nodeRadiusForDegree(5, 5, 7, 13)).toBe(13)
    expect(nodeRadiusForDegree(0, 0, 7, 13)).toBe(7)
  })

  it('半径随连接数单调递增，并随上下限缩放', () => {
    expect(nodeRadiusForDegree(2, 5, 7, 13)).toBeGreaterThan(nodeRadiusForDegree(1, 5, 7, 13))
    expect(nodeRadiusForDegree(5, 5, 4, 20)).toBe(20)
    expect(nodeRadiusForDegree(0, 5, 4, 20)).toBe(4)
  })
})
