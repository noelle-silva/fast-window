import * as React from 'react'
import { Box, CircularProgress, Slider, Typography } from '@mui/material'
import type { NoteMeta } from '../core'
import type { HyperCortexGateway } from '../gateway'
import { buildGlobalRelationGraph } from '../globalRelationGraph'
import { useRefIndex } from './useRefIndex'
import { GlobalRelationGraphCanvas } from './GlobalRelationGraphCanvas'

// 全局关系图页面：装载笔记索引与引用索引，推导全图，渲染画布并提供布局参数调节。
// 节点取自笔记索引（全部笔记，含孤立笔记），边取自引用索引；点击节点跳转到对应笔记。

const DEFAULT_REPULSION = 120
const MIN_REPULSION = 10
const MAX_REPULSION = 600
const DEFAULT_CENTER_STRENGTH = 0.06
const MIN_CENTER_STRENGTH = 0
const MAX_CENTER_STRENGTH = 0.4
const CENTER_STRENGTH_STEP = 0.01

export function GlobalRelationGraphPage(props: {
  gateway: HyperCortexGateway
  repoId: string
  notes: NoteMeta[]
  notesLoading: boolean
  refreshSignal: number
  onOpenNote: (note: NoteMeta) => void
}) {
  const { gateway, repoId, notes, notesLoading, refreshSignal, onOpenNote } = props
  const { refIndex, loading: refLoading, error: refError } = useRefIndex(gateway, repoId, refreshSignal)

  const graph = React.useMemo(() => buildGlobalRelationGraph(notes, refIndex), [notes, refIndex])

  const [repulsion, setRepulsion] = React.useState(DEFAULT_REPULSION)
  const [centerStrength, setCenterStrength] = React.useState(DEFAULT_CENTER_STRENGTH)

  const handleOpenNode = React.useCallback(
    (id: string) => {
      const note = notes.find(item => item.id === id)
      if (note) onOpenNote(note)
    },
    [notes, onOpenNote],
  )

  const busy = notesLoading || refLoading

  return (
    <Box sx={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 1, p: 2, boxSizing: 'border-box' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 900, color: 'var(--hc-text)' }}>全局关系图</Typography>
        <Typography sx={{ fontSize: 12, color: 'var(--hc-text-subtle)' }}>
          {graph.nodes.length} 个笔记 · {graph.edges.length} 条引用
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography sx={{ fontSize: 12, fontWeight: 800, color: 'var(--hc-text-muted)', whiteSpace: 'nowrap' }}>斥力</Typography>
          <Slider
            size="small"
            min={MIN_REPULSION}
            max={MAX_REPULSION}
            step={10}
            value={repulsion}
            onChange={(_event, value) => setRepulsion(value as number)}
            sx={{ width: 120 }}
          />
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography sx={{ fontSize: 12, fontWeight: 800, color: 'var(--hc-text-muted)', whiteSpace: 'nowrap' }}>紧凑度</Typography>
          <Slider
            size="small"
            min={MIN_CENTER_STRENGTH}
            max={MAX_CENTER_STRENGTH}
            step={CENTER_STRENGTH_STEP}
            value={centerStrength}
            onChange={(_event, value) => setCenterStrength(value as number)}
            sx={{ width: 120 }}
          />
        </Box>
      </Box>

      <Box
        sx={{
          position: 'relative',
          flex: 1,
          minHeight: 0,
          border: '1px solid var(--hc-text-subtle)',
          borderRadius: 2,
          overflow: 'hidden',
          bgcolor: 'var(--hc-surface)',
        }}
      >
        {busy ? (
          <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5 }}>
            <CircularProgress size={22} />
            <Typography sx={{ fontSize: 13, color: 'var(--hc-text-muted)' }}>正在构建关系图…</Typography>
          </Box>
        ) : refError ? (
          <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}>
            <Typography sx={{ fontSize: 13, color: 'var(--hc-danger)', textAlign: 'center' }}>{refError}</Typography>
          </Box>
        ) : graph.nodes.length ? (
          <GlobalRelationGraphCanvas
            graph={graph}
            chargeStrength={-repulsion}
            centerStrength={centerStrength}
            onOpenNode={handleOpenNode}
          />
        ) : (
          <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}>
            <Typography sx={{ fontSize: 13, color: 'var(--hc-text-subtle)' }}>暂无笔记，先创建一些笔记吧</Typography>
          </Box>
        )}
      </Box>
    </Box>
  )
}
