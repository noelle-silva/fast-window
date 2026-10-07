import * as React from 'react'
import { Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material'
import AttachFileRoundedIcon from '@mui/icons-material/AttachFileRounded'
import FolderRoundedIcon from '@mui/icons-material/FolderRounded'
import LayersRoundedIcon from '@mui/icons-material/LayersRounded'
import NotesRoundedIcon from '@mui/icons-material/NotesRounded'
import type { AssetEntry } from '../assetTypes'
import type { NoteMeta, VaultScope } from '../core'
import type { HyperCortexFavoritesDocV1 } from '../favorites'
import type { HyperCortexGateway, HyperCortexTrashItem } from '../gateway'
import { softButtonSx } from './pluginUiStyles'
import { EntityIcon } from './entity-icon/EntityIcon'
import { useWorkspaceVisible } from './workspaceVisibility'

// 回收站条目图标：图片图标的展示路径已是仓库根相对（图标文件随条目进了回收站），
// 因此统一按仓库根相对读取；笔记/附件/收藏夹各自回退到类型默认图标。
function TrashItemIcon(props: { item: HyperCortexTrashItem }): React.ReactNode {
  const { item } = props
  const fallback =
    item.kind === 'asset' ? <AttachFileRoundedIcon fontSize="small" /> : item.kind === 'face' ? <LayersRoundedIcon fontSize="small" /> : item.kind === 'folder' ? <FolderRoundedIcon fontSize="small" /> : <NotesRoundedIcon fontSize="small" />
  if (item.kind === 'face') return fallback
  return <EntityIcon icon={item.icon} fallback={fallback} targetKind="asset" targetRef="" size={18} />
}

function formatDateTime(ms: number): string {
  if (!(Number(ms) > 0)) return ''
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function TrashPanel(props: {
  gateway: HyperCortexGateway
  scope: VaultScope
  /** 外部改动信号：变化时就地重载回收站列表（首次不重复触发，初始装载已覆盖）。 */
  refreshSignal?: number
  onRestored?: (meta: NoteMeta, kind: Exclude<HyperCortexTrashItem['kind'], 'folder'>) => void
  onAssetRestored?: (asset: AssetEntry) => void
  onFavoritesRestored?: (doc: HyperCortexFavoritesDocV1) => void
  onPermanentlyDeleted?: (item: HyperCortexTrashItem) => void
}) {
  const { gateway, scope, refreshSignal, onRestored, onAssetRestored, onFavoritesRestored, onPermanentlyDeleted } = props
  const workspaceVisible = useWorkspaceVisible()
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [items, setItems] = React.useState<HyperCortexTrashItem[]>([])

  const [deleteTarget, setDeleteTarget] = React.useState<HyperCortexTrashItem | null>(null)
  const [deleting, setDeleting] = React.useState(false)
  const [restoringId, setRestoringId] = React.useState<string>('')

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await gateway.trash.listTrashItems(scope)
      setItems(list)
    } catch (e: any) {
      setError(String(e?.message || e || '加载回收站失败'))
    } finally {
      setLoading(false)
    }
  }, [gateway, scope])

  React.useEffect(() => {
    void load()
  }, [load])

  // 外部改动通知：就地重载回收站列表，不动其它界面状态；首次挂载已由上面的装载覆盖。
  const lastRefreshSignalRef = React.useRef(refreshSignal)
  React.useEffect(() => {
    if (refreshSignal === lastRefreshSignalRef.current) return
    lastRefreshSignalRef.current = refreshSignal
    void load()
  }, [refreshSignal, load])

  const handleRestore = React.useCallback(
    async (item: HyperCortexTrashItem) => {
      if (!item?.id) return
      if (restoringId) return
      setRestoringId(item.id)
      try {
        const result = await gateway.trash.restoreTrashItem(scope, item)
        if (result.meta && (item.kind === 'note' || item.kind === 'asset' || item.kind === 'face')) onRestored?.(result.meta, item.kind)
        if (result.asset) onAssetRestored?.(result.asset)
        if (result.favorites) onFavoritesRestored?.(result.favorites)
        setItems(prev => prev.filter(x => x.dir !== item.dir))
      } catch (e: any) {
        setError(String(e?.message || e || '恢复失败'))
      } finally {
        setRestoringId('')
      }
    },
    [gateway, onAssetRestored, onFavoritesRestored, onRestored, restoringId, scope],
  )

  const confirmDelete = React.useCallback((item: HyperCortexTrashItem) => setDeleteTarget(item), [])

  const doDelete = React.useCallback(async () => {
    const target = deleteTarget
    if (!target) return
    if (deleting) return
    setDeleting(true)
    try {
      await gateway.trash.permanentlyDeleteTrashItem(scope, target)
      onPermanentlyDeleted?.(target)
      setItems(prev => prev.filter(x => x.dir !== target.dir))
      setDeleteTarget(null)
    } catch (e: any) {
      setError(String(e?.message || e || '永久删除失败'))
    } finally {
      setDeleting(false)
    }
  }, [gateway, deleteTarget, deleting, onPermanentlyDeleted, scope])

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 860 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Typography sx={{ fontSize: 24, lineHeight: 1.25, fontWeight: 900, color: '#111' }}>回收站</Typography>
        <Button variant="text" size="small" onClick={() => void load()} disabled={loading} sx={{ ...softButtonSx, borderRadius: 2 }}>
          刷新
        </Button>
      </Box>

      {loading ? <Typography color="text.secondary">正在加载回收站...</Typography> : null}
      {!loading && error ? <Typography color="error">{error}</Typography> : null}
      {!loading && !error && items.length === 0 ? <Typography color="text.secondary">回收站是空的。</Typography> : null}

      {!loading && !error && items.length > 0 ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          {items.map(item => {
            const restoring = restoringId === item.id
            return (
              <Box
                key={item.dir}
                sx={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  gap: 1,
                  px: 1.25,
                  py: 1,
                  borderRadius: 3,
                  bgcolor: '#fff',
                  boxShadow: '0 1px 2px rgba(0,0,0,.04)',
                }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontSize: 14, fontWeight: 800, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.title || '未命名'}
                  </Typography>
                  <Chip
                    size="small"
                    icon={<TrashItemIcon item={item} />}
                    label={item.kind === 'asset' ? '附件' : item.kind === 'face' ? '笔记面' : item.kind === 'folder' ? '收藏夹' : '笔记'}
                    sx={{ mt: 0.75, height: 22, fontSize: 11, fontWeight: 800 }}
                  />
                  <Typography sx={{ fontSize: 12, color: 'rgba(0,0,0,.58)', lineHeight: 1.6 }}>
                    删除时间：{formatDateTime(item.deletedAtMs) || '未知'}
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Button size="small" variant="text" onClick={() => void handleRestore(item)} disabled={restoring || deleting} sx={{ ...softButtonSx, borderRadius: 2 }}>
                    {restoring ? '恢复中…' : '恢复'}
                  </Button>
                  <Button size="small" color="error" variant="contained" onClick={() => confirmDelete(item)} disabled={restoring || deleting}>
                    永久删除
                  </Button>
                </Box>
              </Box>
            )
          })}
        </Box>
      ) : null}

      <Dialog open={workspaceVisible && !!deleteTarget} onClose={() => setDeleteTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>永久删除</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 13, lineHeight: 1.6, color: 'rgba(0,0,0,.72)' }}>
            确定永久删除「{deleteTarget?.title || '未命名'}」吗？此操作不可撤销。
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)} disabled={deleting}>取消</Button>
          <Button variant="contained" color="error" onClick={() => void doDelete()} disabled={deleting}>
            {deleting ? '删除中…' : '永久删除'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

