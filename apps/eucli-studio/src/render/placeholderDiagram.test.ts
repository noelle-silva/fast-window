import { describe, expect, it } from 'vitest'
import {
  buildPlaceholderDependencyDiagram,
  planPlaceholderDependencyDiagram,
  type PlaceholderDiagramColors,
} from './placeholderDiagram'
import type { PlaceholderDependencyNode } from '../domain/placeholder'

const COLORS: PlaceholderDiagramColors = {
  rootNodeFill: '#eff6ff',
  rootNodeStroke: '#3b82f6',
  rootNodeText: '#1d4ed8',
  missingNodeFill: '#fef2f2',
  missingNodeStroke: '#ef4444',
  missingNodeText: '#b91c1c',
  cycleNodeFill: '#fffbeb',
  cycleNodeStroke: '#f59e0b',
  cycleNodeText: '#b45309',
}

describe('buildPlaceholderDependencyDiagram', () => {
  it('空树返回空字符串', () => {
    expect(buildPlaceholderDependencyDiagram(null, { colors: COLORS })).toBe('')
    expect(buildPlaceholderDependencyDiagram({ name: '' }, { colors: COLORS })).toBe('')
  })

  it('根节点使用带 {{}} 的标签并标记根样式', () => {
    const source = buildPlaceholderDependencyDiagram({ name: 'user' }, { colors: COLORS })
    expect(source).toContain('flowchart LR')
    expect(source).toContain('n0(["{{user}}"])')
    expect(source).toContain('class n0 rootNode')
  })

  it('子节点生成边与圆角节点', () => {
    const tree: PlaceholderDependencyNode = { name: 'a', children: [{ name: 'b' }] }
    const source = buildPlaceholderDependencyDiagram(tree, { colors: COLORS })
    expect(source).toContain('n0(["{{a}}"])')
    expect(source).toContain('n1("{{b}}")')
    expect(source).toContain('n0 --> n1')
  })

  it('未注册与循环节点带后缀并标记样式', () => {
    const tree: PlaceholderDependencyNode = {
      name: 'a',
      children: [{ name: 'missing', missing: true }, { name: 'a', cycle: true }],
    }
    const source = buildPlaceholderDependencyDiagram(tree, { colors: COLORS })
    expect(source).toContain('n1("{{missing}}（未注册）")')
    expect(source).toContain('class n1 missingNode')
    expect(source).toContain('n2("{{a}}（循环）")')
    expect(source).toContain('class n2 cycleNode')
  })

  it('标签里的双引号转义为实体', () => {
    const source = buildPlaceholderDependencyDiagram({ name: 'a"b' }, { colors: COLORS })
    expect(source).toContain('{{a#quot;b}}')
  })

  it('自定义根标签时根节点不再包 {{}}，子节点保持占位符样式', () => {
    const tree: PlaceholderDependencyNode = { name: '晶晶', children: [{ name: 'user' }] }
    const source = buildPlaceholderDependencyDiagram(tree, { rootLabel: '晶晶', colors: COLORS })
    expect(source).toContain('n0(["晶晶"])')
    expect(source).toContain('n1("{{user}}")')
    expect(source).not.toContain('{{晶晶}}')
  })

  it('自定义根标签为空时回退为占位符样式', () => {
    const source = buildPlaceholderDependencyDiagram({ name: 'user' }, { rootLabel: '   ', colors: COLORS })
    expect(source).toContain('n0(["{{user}}"])')
  })

  it('使用传入的颜色渲染 classDef', () => {
    const source = buildPlaceholderDependencyDiagram({ name: 'a' }, { colors: COLORS })
    expect(source).toContain(`classDef rootNode fill:${COLORS.rootNodeFill},stroke:${COLORS.rootNodeStroke},color:${COLORS.rootNodeText}`)
  })
})

describe('planPlaceholderDependencyDiagram', () => {
  it('按渲染顺序给出节点索引，并标记根节点', () => {
    const tree: PlaceholderDependencyNode = {
      name: '晶晶',
      children: [{ name: 'a', children: [{ name: 'b' }] }, { name: 'missing', missing: true }],
    }
    const plan = planPlaceholderDependencyDiagram(tree, { rootLabel: '晶晶', colors: COLORS })
    expect(plan.nodes).toEqual([
      { id: 'n0', name: '晶晶', root: true },
      { id: 'n1', name: 'a', root: false },
      { id: 'n2', name: 'b', root: false },
      { id: 'n3', name: 'missing', root: false },
    ])
    expect(plan.source).toContain('n3("{{missing}}（未注册）")')
  })

  it('空树返回空计划', () => {
    expect(planPlaceholderDependencyDiagram(null, { colors: COLORS })).toEqual({ source: '', nodes: [] })
  })
})
