import * as React from 'react'
import { Box, CircularProgress, IconButton, Typography } from '@mui/material'
import ChevronLeftRoundedIcon from '@mui/icons-material/ChevronLeftRounded'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'

import type { NoteMeta, VaultScope } from '../core'
import type { HyperCortexGateway } from '../gateway'
import type { HyperCortexGraphSettingsV1 } from '../graphSettings'
import { buildGlobalRelationGraph } from '../globalRelationGraph'
import { refIndexFromRelations, type NoteRefRelationResult } from '../noteRefs'
import { GlobalRelationGraphCanvas } from './GlobalRelationGraphCanvas'
import { PageOverlayHost } from './PageOverlayHost'
import { useWorkspaceVisible } from './workspaceVisibility'

/**
 * 笔记局部关系图：以当前笔记为关注点，按「查看半径」（跳数）展开的引用子图。
 * 固定以模态窗呈现（不参与「页面显示方式」切换）；外观与全局关系图共用同一画布与交互，
 * 复用全局关系图已持久化的外观设置，但不提供设置入口；关注笔记节点特别高亮。
 */
export type NoteLocalRelationGraphDialogProps = {
  open: boolean
  gateway: HyperCortexGateway
  scope: VaultScope
  noteId: string
  allNotesById: Record<string, NoteMeta>
  settings: HyperCortexGraphSettingsV1
  /** 引用关系版本：笔记保存/删除/恢复后自增，触发子图重取。 */
  refRelationsEpoch: number
  onClose: () => void
  onOpenNote: (note: NoteMeta) => void
}

const MIN_RADIUS = 1
/** 进入局部关系图时的初始缩放：比默认视角拉近约 2 倍。 */
const LOCAL_GRAPH_INITIAL_SCALE = 2

export function NoteLocalRelationGraphDialog(props: NoteLocalRelationGraphDialogProps): React.ReactNode {
  const { open, gateway, scope, noteId, allNotesById, settings, refRelationsEpoch, onClose, onOpenNote } = props
  const workspaceVisible = useWorkspaceVisible()

  const [radius, setRadius] = React.useState(MIN_RADIUS)
  const [result, setResult] = React.useState<NoteRefRelationResult | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState('')

  React.useEffect(() => {
    if (!open || !noteId) return
    let cancelled = false
    setLoading(true)
    setError('')
    void gateway.refs
      .queryRelations(scope, noteId, radius, 'both')
      .then(next => {
        if (!cancelled) setResult(next)
      })
      .catch((cause: any) => {
        if (cancelled) return
        setError(String(cause?.message || cause || '加载局部关系图失败'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [gateway, noteId, open, radius, refRelationsEpoch, scope])

  // 关系子图 = 可达节点集合上诱导出的关系图：复用全局关系图的同一构建逻辑。
  const graph = React.useMemo(() => {
    if (!result) return null
    const reachable = new Set<string>()
    for (const node of result.nodes || []) {
      const id = String(node?.noteId || '').trim()
      if (id) reachable.add(id)
    }
    const localNotes = Object.values(allNotesById).filter(note => reachable.has(note.id))
    return buildGlobalRelationGraph(localNotes, refIndexFromRelations(result.edges))
  }, [allNotesById, result])

  const handleOpenNode = React.useCallback(
    (id: string) => {
      const meta = allNotesById[String(id || '').trim()]
      if (!meta) return
      onOpenNote(meta)
      onClose()
    },
    [allNotesById, onClose, onOpenNote],
  )

  return (
    <PageOverlayHost open={workspaceVisible && open} onClose={onClose} paperWidth="min(560px, 47vw)" paperHeight="67.5vh">
      <Box sx={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
          <IconButton
            size="small"
            aria-label="减小查看半径"
            disabled={radius <= MIN_RADIUS}
            onClick={() => setRadius(prev => Math.max(MIN_RADIUS, prev - 1))}
            sx={{ color: 'var(--hc-text-muted)', '&:hover': { bgcolor: 'var(--hc-surface-soft)' } }}
          >
            <ChevronLeftRoundedIcon fontSize="small" />
          </IconButton>
          <Typography sx={{ minWidth: 96, textAlign: 'center', fontSize: 13, fontWeight: 900, color: 'var(--hc-text)' }}>
            查看半径 {radius}
          </Typography>
          <IconButton
            size="small"
            aria-label="增大查看半径"
            onClick={() => setRadius(prev => prev + 1)}
            sx={{ color: 'var(--hc-text-muted)', '&:hover': { bgcolor: 'var(--hc-surface-soft)' } }}
          >
            <ChevronRightRoundedIcon fontSize="small" />
          </IconButton>
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
          {graph && graph.nodes.length ? (
            <GlobalRelationGraphCanvas
              graph={graph}
              chargeStrength={-settings.repulsion}
              centerStrength={settings.centerStrength}
              minNodeRadius={settings.minNodeRadius}
              maxNodeRadius={settings.maxNodeRadius}
              linkWidth={settings.linkWidth}
              showArrows={settings.showArrows}
              dimOnHover={settings.dimOnHover}
              highlightNodeId={noteId}
              initialScale={LOCAL_GRAPH_INITIAL_SCALE}
              onOpenNode={handleOpenNode}
            />
          ) : loading ? (
            <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5 }}>
              <CircularProgress size={22} />
              <Typography sx={{ fontSize: 13, color: 'var(--hc-text-muted)' }}>正在构建关系图…</Typography>
            </Box>
          ) : error ? (
            <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}>
              <Typography sx={{ fontSize: 13, color: 'var(--hc-danger)', textAlign: 'center' }}>{error}</Typography>
            </Box>
          ) : (
            <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}>
              <Typography sx={{ fontSize: 13, color: 'var(--hc-text-subtle)' }}>暂无关联笔记</Typography>
            </Box>
          )}

          {graph && graph.nodes.length && (loading || error) ? (
            <Box sx={{ position: 'absolute', top: 8, right: 8, display: 'flex', alignItems: 'center', gap: 1, px: 1, py: 0.5, borderRadius: 999, bgcolor: 'rgba(255,255,255,.72)', backdropFilter: 'blur(4px)' }}>
              {loading ? <CircularProgress size={14} /> : null}
              {error ? <Typography sx={{ fontSize: 12, color: 'var(--hc-danger)' }}>刷新失败</Typography> : null}
            </Box>
          ) : null}
        </Box>
      </Box>
    </PageOverlayHost>
  )
}
