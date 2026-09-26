import * as React from 'react'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded'
import RestoreFromTrashRoundedIcon from '@mui/icons-material/RestoreFromTrashRounded'
import { Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Menu, MenuItem, TextField, Tooltip, Typography } from '@mui/material'
import type { HyperCortexRepo } from '../../gateway'
import { menuDangerItemSx, menuPaperSx, softButtonSx } from '../pluginUiStyles'

type Props = {
  repos: HyperCortexRepo[]
  activeRepoId: string
  onRenameRepo: (repoId: string, title: string) => Promise<void> | void
  onDeleteRepo: (repoId: string) => Promise<void> | void
  onOpenRepoTrash: () => void
}

export function RepoManagementSettingsPanel(props: Props) {
  const { repos, activeRepoId, onRenameRepo, onDeleteRepo, onOpenRepoTrash } = props
  const [renameTarget, setRenameTarget] = React.useState<{ id: string; title: string } | null>(null)
  const [renameBusy, setRenameBusy] = React.useState(false)
  const [menuState, setMenuState] = React.useState<{ anchorEl: HTMLElement; repo: HyperCortexRepo } | null>(null)
  const [deleteTarget, setDeleteTarget] = React.useState<HyperCortexRepo | null>(null)
  const [deleteBusy, setDeleteBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const canDelete = React.useCallback(
    (repo: HyperCortexRepo) => repos.length > 1 && repo.id !== activeRepoId,
    [activeRepoId, repos.length],
  )

  const submitRename = React.useCallback(async () => {
    const target = renameTarget
    if (!target || renameBusy) return
    const title = String(target.title || '').trim()
    if (!title) return
    setRenameBusy(true)
    setError(null)
    try {
      await onRenameRepo(target.id, title)
      setRenameTarget(null)
    } catch (e: any) {
      setError(String(e?.message || e || '重命名仓库失败'))
    } finally {
      setRenameBusy(false)
    }
  }, [onRenameRepo, renameBusy, renameTarget])

  const confirmDelete = React.useCallback(async () => {
    const target = deleteTarget
    if (!target || deleteBusy) return
    setDeleteBusy(true)
    setError(null)
    try {
      await onDeleteRepo(target.id)
      setDeleteTarget(null)
    } catch (e: any) {
      setError(String(e?.message || e || '删除仓库失败'))
    } finally {
      setDeleteBusy(false)
    }
  }, [deleteBusy, deleteTarget, onDeleteRepo])

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, minWidth: 0 }}>
          <Typography sx={{ fontSize: 18, lineHeight: 1.25, fontWeight: 900, color: 'var(--hc-text)' }}>仓库管理</Typography>
          <Typography sx={{ fontSize: 13, lineHeight: 1.6, color: 'var(--hc-text-muted)' }}>
            每个仓库拥有独立的笔记、附件与收藏夹空间；重命名只改名称，数据文件夹与仓库标识保持不变。
          </Typography>
        </Box>
        <Button
          variant="text"
          size="small"
          startIcon={<RestoreFromTrashRoundedIcon fontSize="small" />}
          onClick={onOpenRepoTrash}
          sx={{ ...softButtonSx, px: 1.5, flex: '0 0 auto' }}
        >
          仓库回收站
        </Button>
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, p: 1, borderRadius: 3, bgcolor: 'var(--hc-surface-soft)' }}>
        {repos.length === 0 ? (
          <Typography sx={{ px: 0.5, py: 1, fontSize: 13, color: 'var(--hc-text-muted)' }}>暂无可管理的仓库。</Typography>
        ) : (
          repos.map(repo => {
            const active = repo.id === activeRepoId
            return (
              <Box
                key={repo.id}
                sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1, py: 0.75, borderRadius: 2, bgcolor: 'var(--hc-surface)' }}
              >
                <Tooltip title="重命名仓库" placement="top">
                  <IconButton size="small" aria-label={`重命名仓库 ${repo.title}`} onClick={() => setRenameTarget({ id: repo.id, title: repo.title })}>
                    <EditRoundedIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Typography noWrap sx={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: active ? 900 : 700, color: 'var(--hc-text)' }}>
                  {repo.title}
                </Typography>
                {active ? <Chip size="small" label="当前" sx={{ height: 20, fontSize: 11, fontWeight: 800 }} /> : null}
                <Tooltip title="更多操作" placement="top">
                  <IconButton
                    size="small"
                    aria-label={`仓库操作 ${repo.title}`}
                    onClick={event => setMenuState({ anchorEl: event.currentTarget, repo })}
                  >
                    <MoreHorizRoundedIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Box>
            )
          })
        )}
      </Box>

      <Typography sx={{ fontSize: 12, lineHeight: 1.6, color: 'var(--hc-text-subtle)' }}>
        当前正在使用的仓库不可删除，且仓库池至少保留一个仓库；删除的仓库会整仓进入仓库回收站，可随时恢复。
      </Typography>
      {error ? <Typography sx={{ fontSize: 12.5, color: 'var(--hc-danger)' }}>{error}</Typography> : null}

      <Menu
        anchorEl={menuState?.anchorEl || null}
        open={!!menuState}
        onClose={() => setMenuState(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        PaperProps={{ sx: { ...menuPaperSx, minWidth: 160, mt: 0.5 } }}
      >
        <MenuItem
          disabled={!menuState || !canDelete(menuState.repo)}
          onClick={() => {
            const state = menuState
            setMenuState(null)
            if (!state || !canDelete(state.repo)) return
            setDeleteTarget(state.repo)
          }}
          sx={{ ...menuDangerItemSx, borderRadius: 2, mx: 0.5 }}
        >
          <DeleteOutlineRoundedIcon sx={{ fontSize: 16, mr: 1 }} />
          删除
        </MenuItem>
      </Menu>

      <Dialog
        open={!!renameTarget}
        onClose={renameBusy ? undefined : () => setRenameTarget(null)}
        maxWidth="xs"
        fullWidth
        PaperProps={{ sx: { borderRadius: 7 } }}
      >
        <DialogTitle>重命名仓库</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="仓库名称"
            fullWidth
            value={renameTarget?.title || ''}
            disabled={renameBusy}
            onChange={event => setRenameTarget(current => (current ? { ...current, title: event.target.value } : current))}
            onKeyDown={event => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              void submitRename()
            }}
          />
          <Typography sx={{ mt: 1.25, fontSize: 12, lineHeight: 1.6, color: 'var(--hc-text-subtle)' }}>
            只修改仓库名称；数据文件夹与仓库标识保持不变。
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenameTarget(null)} disabled={renameBusy}>取消</Button>
          <Button variant="contained" onClick={() => void submitRename()} disabled={renameBusy || !String(renameTarget?.title || '').trim()}>
            {renameBusy ? '保存中…' : '保存'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={!!deleteTarget}
        onClose={deleteBusy ? undefined : () => setDeleteTarget(null)}
        maxWidth="xs"
        fullWidth
        PaperProps={{ sx: { borderRadius: 7 } }}
      >
        <DialogTitle>移入仓库回收站</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 13, lineHeight: 1.7, color: 'var(--hc-text)' }}>
            确定将仓库「{deleteTarget?.title || ''}」移入仓库回收站吗？仓库数据会整仓保留，可稍后在仓库回收站恢复。
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)} disabled={deleteBusy}>取消</Button>
          <Button variant="contained" color="error" onClick={() => void confirmDelete()} disabled={deleteBusy}>
            {deleteBusy ? '处理中…' : '移入回收站'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
