import * as React from 'react'
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material'
import type { Api, NoteMeta, VaultScope } from '../core'
import { listTrashItems, permanentlyDeleteNoteDir, restoreTrashItem, type HyperCortexTrashItem } from '../trash'

function formatDateTime(ms: number): string {
  if (!(Number(ms) > 0)) return ''
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function TrashPanel(props: {
  api: Api
  scope: VaultScope
  onRestored?: (meta: NoteMeta) => void
  onPermanentlyDeleted?: (noteId: string) => void
}) {
  const { api, scope, onRestored, onPermanentlyDeleted } = props
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
      const list = await listTrashItems(api, scope)
      setItems(list)
    } catch (e: any) {
      setError(String(e?.message || e || '加载回收站失败'))
    } finally {
      setLoading(false)
    }
  }, [api, scope])

  React.useEffect(() => {
    void load()
  }, [load])

  const handleRestore = React.useCallback(
    async (item: HyperCortexTrashItem) => {
      if (!item?.id) return
      if (restoringId) return
      setRestoringId(item.id)
      try {
        const result = await restoreTrashItem(api, scope, item)
        onRestored?.(result.meta)
        setItems(prev => prev.filter(x => x.id !== item.id))
      } catch (e: any) {
        setError(String(e?.message || e || '恢复失败'))
      } finally {
        setRestoringId('')
      }
    },
    [api, onRestored, restoringId, scope],
  )

  const confirmDelete = React.useCallback((item: HyperCortexTrashItem) => setDeleteTarget(item), [])

  const doDelete = React.useCallback(async () => {
    const target = deleteTarget
    if (!target) return
    if (deleting) return
    setDeleting(true)
    try {
      await permanentlyDeleteNoteDir(api, scope, target.id, target.dir)
      onPermanentlyDeleted?.(target.id)
      setItems(prev => prev.filter(x => x.id !== target.id))
      setDeleteTarget(null)
    } catch (e: any) {
      setError(String(e?.message || e || '永久删除失败'))
    } finally {
      setDeleting(false)
    }
  }, [api, deleteTarget, deleting, onPermanentlyDeleted, scope])

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 860 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Typography sx={{ fontSize: 24, lineHeight: 1.25, fontWeight: 900, color: '#111' }}>回收站</Typography>
        <Button variant="outlined" size="small" onClick={() => void load()} disabled={loading}>
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
                  <Typography sx={{ fontSize: 12, color: 'rgba(0,0,0,.58)', lineHeight: 1.6 }}>
                    删除时间：{formatDateTime(item.deletedAtMs) || '未知'}
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Button size="small" variant="outlined" onClick={() => void handleRestore(item)} disabled={restoring || deleting}>
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

      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} maxWidth="xs" fullWidth>
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

