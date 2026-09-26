import * as React from 'react'
import { Box, Button, Typography } from '@mui/material'
import type { HyperCortexDeletedRepo, HyperCortexGateway, HyperCortexRepo } from '../../gateway'
import { softButtonSx } from '../pluginUiStyles'

function formatDateTime(ms: number): string {
  if (!(Number(ms) > 0)) return ''
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function RepoTrashPanel(props: {
  gateway: HyperCortexGateway
  onRestored?: (repo: HyperCortexRepo) => void
}) {
  const { gateway, onRestored } = props
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [items, setItems] = React.useState<HyperCortexDeletedRepo[]>([])
  const [restoringId, setRestoringId] = React.useState('')

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setItems(await gateway.repos.listDeletedRepos())
    } catch (e: any) {
      setError(String(e?.message || e || '加载仓库回收站失败'))
    } finally {
      setLoading(false)
    }
  }, [gateway])

  React.useEffect(() => {
    void load()
  }, [load])

  const handleRestore = React.useCallback(
    async (item: HyperCortexDeletedRepo) => {
      if (!item?.id || restoringId) return
      setRestoringId(item.id)
      setError(null)
      try {
        const restored = await gateway.repos.restoreRepo(item.id)
        setItems(prev => prev.filter(entry => entry.id !== item.id))
        onRestored?.(restored)
      } catch (e: any) {
        setError(String(e?.message || e || '恢复仓库失败'))
      } finally {
        setRestoringId('')
      }
    },
    [gateway, onRestored, restoringId],
  )

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 860 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
          <Typography sx={{ fontSize: 24, lineHeight: 1.25, fontWeight: 900, color: 'var(--hc-text)' }}>仓库回收站</Typography>
          <Typography sx={{ fontSize: 13, lineHeight: 1.6, color: 'var(--hc-text-muted)' }}>
            被删除的仓库整仓保存在这里，可随时恢复；仓库不会自动清理。
          </Typography>
        </Box>
        <Button variant="text" size="small" onClick={() => void load()} disabled={loading} sx={{ ...softButtonSx, borderRadius: 2 }}>
          刷新
        </Button>
      </Box>

      {loading ? <Typography color="text.secondary">正在加载仓库回收站...</Typography> : null}
      {!loading && error ? <Typography color="error">{error}</Typography> : null}
      {!loading && !error && items.length === 0 ? <Typography color="text.secondary">仓库回收站是空的。</Typography> : null}

      {!loading && !error && items.length > 0 ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          {items.map(item => {
            const restoring = restoringId === item.id
            return (
              <Box
                key={item.id}
                sx={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  alignItems: 'center',
                  gap: 1,
                  px: 1.25,
                  py: 1,
                  borderRadius: 3,
                  bgcolor: 'var(--hc-surface)',
                  boxShadow: '0 1px 2px var(--hc-shadow)',
                }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography noWrap sx={{ fontSize: 13.5, fontWeight: 800, color: 'var(--hc-text)' }}>
                    {item.title}
                  </Typography>
                  <Typography sx={{ mt: 0.25, fontSize: 11.5, color: 'var(--hc-text-subtle)' }}>
                    删除时间：{formatDateTime(item.deletedAtMs) || '未知'}
                  </Typography>
                </Box>
                <Button
                  variant="text"
                  size="small"
                  onClick={() => void handleRestore(item)}
                  disabled={restoring}
                  sx={{ ...softButtonSx, borderRadius: 2, px: 1.5 }}
                >
                  {restoring ? '恢复中…' : '恢复'}
                </Button>
              </Box>
            )
          })}
        </Box>
      ) : null}
    </Box>
  )
}
