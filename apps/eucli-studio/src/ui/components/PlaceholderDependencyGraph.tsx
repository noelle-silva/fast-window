import * as React from 'react'
import { Box, Typography } from '@mui/material'
import type { PlaceholderDependencyNode } from '../../domain/placeholder'
import { MERMAID_VIEWER_ZOOM_MAX } from '../../core/viewerZoom'
import { parseSvgSize } from '../../render/mermaidExport'
import { renderMermaidSvg } from '../../render/mermaidRender'
import { planPlaceholderDependencyDiagram } from '../../render/placeholderDiagram'
import { placeholderDiagramColors } from '../colorThemeStyles'
import { useEvent } from '../hooks/useEvent'
import { usePanZoomStage } from '../hooks/usePanZoomStage'
import { useThemeColors } from '../hooks/useThemeColors'

const NODE_ID_PATTERN = /(?:^|[^A-Za-z0-9_])n(\d+)(?![0-9])/

type PlaceholderDependencyGraphProps = {
  tree: PlaceholderDependencyNode | null | undefined
  rootLabel?: string
  height?: number
  onNodeClick?: (name: string) => void
}

export function PlaceholderDependencyGraph(props: PlaceholderDependencyGraphProps) {
  const { tree, rootLabel, height = 360, onNodeClick } = props
  const colors = useThemeColors()

  const plan = React.useMemo(
    () =>
      planPlaceholderDependencyDiagram(tree, {
        rootLabel,
        colors: placeholderDiagramColors(colors),
      }),
    [tree, rootLabel, colors],
  )
  const nodeById = React.useMemo(() => new Map(plan.nodes.map((node) => [node.id, node])), [plan.nodes])

  const [svg, setSvg] = React.useState('')
  const [failure, setFailure] = React.useState('')

  const {
    setStageRef,
    contentSize,
    setContentSize,
    offset,
    effectiveScale,
    dragMovedRef,
    onStageMouseDown,
  } = usePanZoomStage({ active: true, contentKey: svg, maxZoom: MERMAID_VIEWER_ZOOM_MAX })

  React.useEffect(() => {
    let cancelled = false
    if (!plan.source) {
      setSvg('')
      setFailure('')
      return
    }
    void renderMermaidSvg(plan.source)
      .then((next) => {
        if (cancelled) return
        setSvg(next)
        setFailure('')
      })
      .catch((error: unknown) => {
        // 失败原因必须带出来：这里吞掉错误的话，界面上只剩“渲染失败”，排查只能靠猜。
        if (cancelled) return
        setSvg('')
        setFailure(String((error as any)?.message || error || '未知错误'))
      })
    return () => {
      cancelled = true
    }
  }, [plan.source])

  React.useEffect(() => {
    if (!svg) return setContentSize({ w: 0, h: 0 })
    setContentSize(parseSvgSize(svg))
  }, [svg, setContentSize])

  const onStageClick = useEvent((e: React.MouseEvent) => {
    if (dragMovedRef.current) return
    const target = e.target instanceof Element ? e.target : null
    const nodeEl = target?.closest?.('g.node')
    if (!nodeEl) return
    const match = String(nodeEl.getAttribute('id') || '').match(NODE_ID_PATTERN)
    if (!match) return
    const node = nodeById.get(`n${match[1]}`)
    if (!node || node.root) return
    onNodeClick?.(node.name)
  })

  return (
    <Box
      sx={{
        position: 'relative',
        height,
        borderRadius: 2,
        border: '1px solid',
        borderColor: 'divider',
        bgcolor: 'var(--studio-field)',
        boxShadow: 'var(--studio-shadow-soft)',
        overflow: 'hidden',
      }}
    >
      <Box
        ref={setStageRef}
        onMouseDown={onStageMouseDown}
        onClick={onStageClick}
        sx={{
          position: 'absolute',
          inset: 0,
          cursor: svg ? 'grab' : 'default',
          touchAction: 'none',
          '& g.node': { cursor: onNodeClick ? 'pointer' : 'inherit' },
          '& g.node[id^="flowchart-n0-"]': { cursor: 'inherit' },
        }}
      >
        {svg ? (
          <Box sx={{ transform: `translate(${offset.x}px,${offset.y}px)`, display: 'inline-block' }}>
            <Box
              sx={{
                transformOrigin: '0 0',
                transform: `scale(${effectiveScale})`,
                display: 'inline-block',
                userSelect: 'none',
                '& svg': contentSize.w && contentSize.h ? { display: 'block', width: `${contentSize.w}px`, height: `${contentSize.h}px` } : { display: 'block' },
              }}
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          </Box>
        ) : (
          <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
            <Typography variant="caption" color="text.secondary" sx={{ px: 2, textAlign: 'center' }}>
              {failure ? `依赖树渲染失败：${failure}` : '正在生成依赖树…'}
            </Typography>
          </Box>
        )}
      </Box>
    </Box>
  )
}
