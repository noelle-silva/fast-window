import * as React from 'react'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import CheckRoundedIcon from '@mui/icons-material/CheckRounded'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import StorageRoundedIcon from '@mui/icons-material/StorageRounded'
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Divider, Menu, MenuItem, TextField, Tooltip, Typography } from '@mui/material'
import type { HyperCortexRepo } from '../gateway'

const REPO_BUTTON_MAX_WIDTH = 230
const REPO_BUTTON_TITLE_MAX_WIDTH = 140

export function pickNextRepoTitle(repos: HyperCortexRepo[]): string {
  const used = new Set(repos.map(repo => String(repo.title || '').trim()).filter(Boolean))
  for (let i = 1; i <= 999; i += 1) {
    const name = `新仓库 ${i}`
    if (!used.has(name)) return name
  }
  return '新仓库'
}

type RepoSwitcherProps = {
  repos: HyperCortexRepo[]
  activeRepoId: string
  disabled?: boolean
  onSwitch: (repoId: string) => void
  onCreateRequest: () => void
}

export function RepoSwitcher(props: RepoSwitcherProps) {
  const { repos, activeRepoId, disabled, onSwitch, onCreateRequest } = props
  const [anchorEl, setAnchorEl] = React.useState<HTMLElement | null>(null)
  const menuOpen = !!anchorEl
  const activeRepo = repos.find(repo => repo.id === activeRepoId) || null

  const closeMenu = React.useCallback(() => setAnchorEl(null), [])

  return (
    <>
      <Tooltip title="切换仓库" placement="bottom">
        <Button
          size="small"
          aria-label="切换仓库"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          disabled={disabled}
          onClick={event => {
            // currentTarget 在事件结束后会被置空，不能延迟到状态更新器里读取。
            const button = event.currentTarget
            setAnchorEl(current => (current ? null : button))
          }}
          startIcon={<StorageRoundedIcon sx={{ fontSize: 16, color: 'var(--hc-text-muted)' }} />}
          endIcon={<ExpandMoreRoundedIcon sx={{ fontSize: 16, color: 'var(--hc-text-muted)' }} />}
          sx={{
            textTransform: 'none',
            borderRadius: 2,
            height: 32,
            px: 0.75,
            minWidth: 0,
            maxWidth: REPO_BUTTON_MAX_WIDTH,
            color: 'var(--hc-text)',
            bgcolor: menuOpen ? 'var(--hc-surface-soft)' : 'transparent',
            '&:hover': { bgcolor: 'var(--hc-surface-soft)' },
          }}
        >
          <Typography
            component="span"
            sx={{
              fontSize: 12.5,
              fontWeight: 900,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: REPO_BUTTON_TITLE_MAX_WIDTH,
            }}
          >
            {activeRepo?.title || '默认仓库'}
          </Typography>
        </Button>
      </Tooltip>

      <Menu
        anchorEl={anchorEl}
        open={menuOpen}
        onClose={closeMenu}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        PaperProps={{ sx: { minWidth: 220, borderRadius: 3, mt: 0.5 } }}
      >
        {repos.map(repo => {
          const selected = repo.id === activeRepoId
          return (
            <MenuItem
              key={repo.id}
              selected={selected}
              onClick={() => {
                closeMenu()
                if (!selected) onSwitch(repo.id)
              }}
              sx={{ gap: 0.75, borderRadius: 2, mx: 0.5, my: 0.25 }}
            >
              <CheckRoundedIcon sx={{ fontSize: 16, visibility: selected ? 'visible' : 'hidden', color: 'var(--hc-primary)' }} />
              <Typography noWrap sx={{ fontSize: 13, fontWeight: selected ? 900 : 700, maxWidth: 180 }}>
                {repo.title}
              </Typography>
            </MenuItem>
          )
        })}
        <Divider sx={{ my: 0.5 }} />
        <MenuItem
          onClick={() => {
            closeMenu()
            onCreateRequest()
          }}
          sx={{ gap: 0.75, borderRadius: 2, mx: 0.5, mb: 0.5 }}
        >
          <AddRoundedIcon sx={{ fontSize: 16, color: 'var(--hc-text-muted)' }} />
          <Typography sx={{ fontSize: 13, fontWeight: 800 }}>新建仓库…</Typography>
        </MenuItem>
      </Menu>
    </>
  )
}

type RepoCreateDialogProps = {
  open: boolean
  busy: boolean
  defaultTitle: string
  onClose: () => void
  onConfirm: (title: string) => void
}

export function RepoCreateDialog(props: RepoCreateDialogProps) {
  const { open, busy, defaultTitle, onClose, onConfirm } = props
  const [title, setTitle] = React.useState('')

  React.useEffect(() => {
    if (open) setTitle(defaultTitle)
  }, [open, defaultTitle])

  const submit = React.useCallback(() => {
    if (busy) return
    onConfirm(title.trim())
  }, [busy, onConfirm, title])

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth PaperProps={{ sx: { borderRadius: 7 } }}>
      <DialogTitle>新建仓库</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          margin="dense"
          label="仓库名称"
          fullWidth
          value={title}
          disabled={busy}
          onChange={event => setTitle(event.target.value)}
          onKeyDown={event => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            submit()
          }}
        />
        <Typography sx={{ mt: 1.25, fontSize: 12, lineHeight: 1.6, color: 'var(--hc-text-subtle)' }}>
          新仓库拥有独立的笔记、附件与收藏夹空间，与现有仓库互不可见。
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>取消</Button>
        <Button variant="contained" onClick={submit} disabled={busy || !title.trim()}>
          {busy ? '创建中…' : '创建'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
