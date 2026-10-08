import * as React from 'react'
import { Box, CircularProgress, IconButton, Typography } from '@mui/material'
import TuneRoundedIcon from '@mui/icons-material/TuneRounded'
import type { NoteMeta } from '../core'
import type { HyperCortexGateway } from '../gateway'
import type { HyperCortexGraphSettingsV1 } from '../graphSettings'
import { buildGlobalRelationGraph } from '../globalRelationGraph'
import { useRefIndex } from './useRefIndex'
import { GlobalRelationGraphCanvas } from './GlobalRelationGraphCanvas'
import { GlobalRelationGraphSettingsMenu } from './GlobalRelationGraphSettingsMenu'

// 全局关系图页面：装载笔记索引与引用索引，推导全图，渲染画布。
// 顶部行只保留标题、计数与设置按钮；斥力、紧凑度等布局与外观参数收进设置浮层。
// 节点取自笔记索引（全部笔记，含孤立笔记），边取自引用索引；点击节点跳转到对应笔记。

export function GlobalRelationGraphPage(props: {
  gateway: HyperCortexGateway
  repoId: string
  notes: NoteMeta[]
  notesLoading: boolean
  refreshSignal: number
  settings: HyperCortexGraphSettingsV1
  onSettingsChange: (next: HyperCortexGraphSettingsV1) => void
  onOpenNote: (note: NoteMeta) => void
}) {
  const { gateway, repoId, notes, notesLoading, refreshSignal, settings, onSettingsChange, onOpenNote } = props
  const { refIndex, loading: refLoading, error: refError } = useRefIndex(gateway, repoId, refreshSignal)

  const graph = React.useMemo(() => buildGlobalRelationGraph(notes, refIndex), [notes, refIndex])

  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const settingsAnchorRef = React.useRef<HTMLButtonElement | null>(null)

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
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 900, color: 'var(--hc-text)' }}>全局关系图</Typography>
        <Typography sx={{ fontSize: 12, color: 'var(--hc-text-subtle)' }}>
          {graph.nodes.length} 个笔记 · {graph.edges.length} 条引用
        </Typography>
        <Box sx={{ ml: 'auto' }}>
          <IconButton
            ref={settingsAnchorRef}
            size="small"
            aria-label="关系图设置"
            onClick={() => setSettingsOpen(prev => !prev)}
            sx={{
              borderRadius: 2,
              color: settingsOpen ? 'var(--hc-primary)' : 'var(--hc-text-muted)',
              bgcolor: settingsOpen ? 'var(--hc-primary-soft)' : 'transparent',
              '&:hover': { bgcolor: settingsOpen ? 'var(--hc-primary-hover)' : 'var(--hc-surface-soft)' },
            }}
          >
            <TuneRoundedIcon fontSize="small" />
          </IconButton>
        </Box>
      </Box>

      <GlobalRelationGraphSettingsMenu
        open={settingsOpen}
        anchorEl={settingsAnchorRef.current}
        settings={settings}
        onChange={onSettingsChange}
        onClose={() => setSettingsOpen(false)}
      />

      <Box
        sx={{
          position: 'relative',
          flex: 1,
          minHeight: 0,
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
            chargeStrength={-settings.repulsion}
            centerStrength={settings.centerStrength}
            minNodeRadius={settings.minNodeRadius}
            maxNodeRadius={settings.maxNodeRadius}
            linkWidth={settings.linkWidth}
            showArrows={settings.showArrows}
            dimOnHover={settings.dimOnHover}
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
