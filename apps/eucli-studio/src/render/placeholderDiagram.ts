import type { PlaceholderDependencyNode } from '../domain/placeholder'

export type PlaceholderDiagramNode = {
  id: string
  name: string
  root: boolean
}

export type PlaceholderDiagramPlan = {
  source: string
  nodes: PlaceholderDiagramNode[]
}

export type PlaceholderDiagramColors = {
  rootNodeFill: string
  rootNodeStroke: string
  rootNodeText: string
  missingNodeFill: string
  missingNodeStroke: string
  missingNodeText: string
  cycleNodeFill: string
  cycleNodeStroke: string
  cycleNodeText: string
}

function nodeLabel(node: PlaceholderDependencyNode) {
  const suffix = node.cycle ? '（循环）' : node.missing ? '（未注册）' : ''
  return `{{${String(node.name || '')}}}${suffix}`
}

function escapeDiagramLabel(value: string) {
  return value.replace(/"/g, '#quot;').replace(/\s+/g, ' ').trim()
}

export function planPlaceholderDependencyDiagram(
  tree: PlaceholderDependencyNode | null | undefined,
  options: { rootLabel?: string; colors: PlaceholderDiagramColors },
): PlaceholderDiagramPlan {
  const root = tree && tree.name ? tree : null
  if (!root) return { source: '', nodes: [] }
  const rootLabel = String(options.rootLabel ?? '').trim()
  const colors = options.colors

  const lines = [
    '%%{init: {"flowchart": {"curve": "basis", "htmlLabels": false}} }%%',
    'flowchart LR',
    `  classDef rootNode fill:${colors.rootNodeFill},stroke:${colors.rootNodeStroke},color:${colors.rootNodeText}`,
    `  classDef missingNode fill:${colors.missingNodeFill},stroke:${colors.missingNodeStroke},color:${colors.missingNodeText}`,
    `  classDef cycleNode fill:${colors.cycleNodeFill},stroke:${colors.cycleNodeStroke},color:${colors.cycleNodeText}`,
  ]
  const nodes: PlaceholderDiagramNode[] = []
  let counter = 0
  const visit = (node: PlaceholderDependencyNode, parentId: string) => {
    const id = `n${counter}`
    counter += 1
    nodes.push({ id, name: String(node.name || ''), root: !parentId })
    const label = escapeDiagramLabel(parentId || !rootLabel ? nodeLabel(node) : rootLabel)
    lines.push(`  ${id}${parentId ? `("${label}")` : `(["${label}"])`}`)
    if (parentId) lines.push(`  ${parentId} --> ${id}`)
    if (node.cycle) lines.push(`  class ${id} cycleNode`)
    else if (node.missing) lines.push(`  class ${id} missingNode`)
    else if (!parentId) lines.push(`  class ${id} rootNode`)
    const children = Array.isArray(node.children) ? node.children : []
    for (const child of children) visit(child, id)
  }
  visit(root, '')
  return { source: lines.join('\n'), nodes }
}

export function buildPlaceholderDependencyDiagram(
  tree: PlaceholderDependencyNode | null | undefined,
  options: { rootLabel?: string; colors: PlaceholderDiagramColors },
): string {
  return planPlaceholderDependencyDiagram(tree, options).source
}
