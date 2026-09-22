import * as React from 'react'
import { Box, Stack, Typography } from '@mui/material'
import type { PlaceholderDependencyNode } from '../../domain/placeholder'
import { renderMermaidSvg } from '../../render/mermaidRender'
import { buildPlaceholderDependencyDiagram } from '../../render/placeholderDiagram'
import { customScrollbarHiddenSx } from '../scroll/customScrollbars'
import { SettingsSection } from './SettingsSurfaces'

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
    void renderMermaidSvg(source)
      .then((next) => {
        if (cancelled) return
        setSvg(next)
        setFailed(false)
      })
      .catch(() => {
        if (cancelled) return
        setSvg('')
        setFailed(true)
      })
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
