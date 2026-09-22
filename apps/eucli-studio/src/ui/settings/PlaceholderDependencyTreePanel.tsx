import * as React from 'react'
import { Box, Stack, Typography } from '@mui/material'
import { uid } from '../../core/utils'
import type { PlaceholderDependencyNode } from '../../domain/placeholder'
import { sanitizeSvg } from '../../render/sanitize'
import { customScrollbarHiddenSx } from '../scroll/customScrollbars'
import { SettingsSection } from './SettingsSurfaces'

function nodeLabel(node: PlaceholderDependencyNode) {
  const suffix = node.cycle ? '（循环）' : node.missing ? '（未注册）' : ''
  return `{{${String(node.name || '')}}}${suffix}`
}

function escapeDiagramLabel(value: string) {
  return value.replace(/"/g, '#quot;').replace(/\s+/g, ' ').trim()
}

export function buildPlaceholderDependencyDiagram(tree: PlaceholderDependencyNode | null | undefined): string {
  const root = tree && tree.name ? tree : null
  if (!root) return ''
  const lines = [
    '%%{init: {"flowchart": {"curve": "basis", "htmlLabels": false}} }%%',
    'flowchart LR',
    '  classDef rootNode fill:#eff6ff,stroke:#3b82f6,color:#1d4ed8',
    '  classDef missingNode fill:#fef2f2,stroke:#ef4444,color:#b91c1c',
    '  classDef cycleNode fill:#fffbeb,stroke:#f59e0b,color:#b45309',
  ]
  let counter = 0
  const visit = (node: PlaceholderDependencyNode, parentId: string) => {
    const id = `n${counter}`
    counter += 1
    const label = escapeDiagramLabel(nodeLabel(node))
    lines.push(`  ${id}${parentId ? `("${label}")` : `(["${label}"])`}`)
    if (parentId) lines.push(`  ${parentId} --> ${id}`)
    if (node.cycle) lines.push(`  class ${id} cycleNode`)
    else if (node.missing) lines.push(`  class ${id} missingNode`)
    else if (!parentId) lines.push(`  class ${id} rootNode`)
    const children = Array.isArray(node.children) ? node.children : []
    for (const child of children) visit(child, id)
  }
  visit(root, '')
  return lines.join('\n')
}

export function PlaceholderDependencyTreePanel(props: { tree: PlaceholderDependencyNode }) {
  const { tree } = props
  const [svg, setSvg] = React.useState('')
  const [failed, setFailed] = React.useState(false)
  const source = React.useMemo(() => buildPlaceholderDependencyDiagram(tree), [tree])

  React.useEffect(() => {
    let cancelled = false
    if (!source) {
      setSvg('')
      setFailed(false)
      return
    }
    const mermaid = (window as any)?.mermaid
    if (!mermaid || typeof mermaid.render !== 'function') {
      setSvg('')
      setFailed(true)
      return
    }
    const run = async () => {
      try {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'loose',
          theme: 'default',
          themeVariables: {
            fontFamily:
              'system-ui,-apple-system,"Segoe UI","Microsoft YaHei","PingFang SC","Noto Sans CJK SC",Roboto,Arial,sans-serif',
          },
          flowchart: { htmlLabels: false },
        })
        const rendered = await mermaid.render(uid('placeholder-dep'), source)
        if (cancelled) return
        const next = sanitizeSvg(typeof rendered === 'string' ? rendered : rendered?.svg, 'original')
        setSvg(next)
        setFailed(!next)
      } catch {
        if (cancelled) return
        setSvg('')
        setFailed(true)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [source])

  return (
    <SettingsSection tone="muted">
      <Stack spacing={1}>
        <Typography variant="body2" sx={{ fontWeight: 900 }}>依赖树</Typography>
        {!tree?.name ? (
          <Typography variant="body2" color="text.secondary">选择占位符后查看依赖。</Typography>
        ) : failed ? (
          <PlainDependencyList tree={tree} />
        ) : svg ? (
          <Box sx={{ overflowX: 'auto', overflowY: 'hidden', ...customScrollbarHiddenSx, '& svg': { maxWidth: '100%', height: 'auto' } }}>
            <Box sx={{ display: 'inline-block', minWidth: '100%' }} dangerouslySetInnerHTML={{ __html: svg }} />
          </Box>
        ) : (
          <Typography variant="caption" color="text.secondary">正在生成依赖树…</Typography>
        )}
      </Stack>
    </SettingsSection>
  )
}

function PlainDependencyList(props: { tree: PlaceholderDependencyNode }) {
  return <PlainDependencyNode node={props.tree} depth={0} />
}

function PlainDependencyNode(props: { node: PlaceholderDependencyNode; depth: number }) {
  const { node, depth } = props
  const suffix = node.cycle ? '（循环）' : node.missing ? '（未注册）' : ''
  return (
    <Box sx={{ pl: depth * 2 }}>
      <Typography variant="body2" color={node.cycle || node.missing ? 'error' : 'text.primary'}>{`{{${String(node.name || '')}}}`}{suffix}</Typography>
      {Array.isArray(node.children) ? node.children.map((child, index) => <PlainDependencyNode key={`${child.name}:${index}`} node={child} depth={depth + 1} />) : null}
    </Box>
  )
}
