import * as React from 'react'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded'
import VisibilityOffRoundedIcon from '@mui/icons-material/VisibilityOffRounded'
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded'
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Menu, MenuItem, TextField, Tooltip, Typography } from '@mui/material'
import type { AccessService, HyperCortexAccessKey, HyperCortexAccessState, HyperCortexRepo } from '../gateway'
import { menuDangerItemSx, menuPaperSx, softButtonSx } from './pluginUiStyles'
import { useWorkspaceVisible } from './workspaceVisibility'

const MIN_ACCESS_PORT = 1
const MAX_ACCESS_PORT = 65535
const MASKED_KEY_TEXT = '••••••••••••••••'

function formatDateTime(ms: number): string {
  if (!(Number(ms) > 0)) return ''
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

type Props = {
  access: AccessService
  repos: HyperCortexRepo[]
  activeRepoId: string
  onCopyKey: (text: string) => void
}

// 外部访问管理：配置开放端口；每把访问密钥拥有独立身份（名称、绑定仓库、创建时间），
// 密钥只能访问所绑仓库；支持打码显示、复制、编辑与删除。
export function ExternalAccessSettingsPanel(props: Props) {
  const { access, repos, activeRepoId, onCopyKey } = props
  const workspaceVisible = useWorkspaceVisible()
  const [doc, setDoc] = React.useState<HyperCortexAccessState | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [portText, setPortText] = React.useState('')
  const [portBusy, setPortBusy] = React.useState(false)
  const [portError, setPortError] = React.useState<string | null>(null)
  const [revealedKeys, setRevealedKeys] = React.useState<Record<string, boolean>>({})
  const [createOpen, setCreateOpen] = React.useState(false)
  const [createName, setCreateName] = React.useState('')
  const [createRepoId, setCreateRepoId] = React.useState('')
  const [createBusy, setCreateBusy] = React.useState(false)
  const [createError, setCreateError] = React.useState<string | null>(null)
  const [editTarget, setEditTarget] = React.useState<HyperCortexAccessKey | null>(null)
  const [editName, setEditName] = React.useState('')
  const [editRepoId, setEditRepoId] = React.useState('')
  const [editBusy, setEditBusy] = React.useState(false)
  const [editError, setEditError] = React.useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = React.useState<HyperCortexAccessKey | null>(null)
  const [deleteBusy, setDeleteBusy] = React.useState(false)
  const [deleteError, setDeleteError] = React.useState<string | null>(null)
  const [menuState, setMenuState] = React.useState<{ anchorEl: HTMLElement; entry: HyperCortexAccessKey } | null>(null)

  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const loaded = await access.loadAccess()
        if (cancelled) return
        setDoc(loaded)
        setPortText(loaded.port > 0 ? String(loaded.port) : '')
        setLoadError(null)
      } catch (e: any) {
        if (!cancelled) setLoadError(String(e?.message || e || '加载外部访问信息失败'))
      }
    })()
    return () => { cancelled = true }
  }, [access])

  // 仓库池变化时保证绑定仓库选择始终指向现存仓库。
  const validRepoId = React.useCallback(
    (repoId: string) => (repos.some(repo => repo.id === repoId) ? repoId : repos[0]?.id || ''),
    [repos],
  )

  const savePort = React.useCallback(async () => {
    if (portBusy) return
    const port = Number(String(portText).trim())
    if (!Number.isInteger(port) || port < MIN_ACCESS_PORT || port > MAX_ACCESS_PORT) {
      setPortError(`端口必须是 ${MIN_ACCESS_PORT} 到 ${MAX_ACCESS_PORT} 之间的整数`)
      return
    }
    setPortBusy(true)
    setPortError(null)
    try {
      const next = await access.saveAccessPort(port)
      setDoc(next)
      setPortText(next.port > 0 ? String(next.port) : '')
    } catch (e: any) {
      setPortError(String(e?.message || e || '保存端口失败'))
    } finally {
      setPortBusy(false)
    }
  }, [access, portBusy, portText])

  const openCreate = React.useCallback(() => {
    setCreateName('')
    setCreateRepoId(validRepoId(activeRepoId))
    setCreateError(null)
    setCreateOpen(true)
  }, [activeRepoId, validRepoId])

  const submitCreate = React.useCallback(async () => {
    if (createBusy) return
    const name = createName.trim()
    if (!name) {
      setCreateError('名称不能为空')
      return
    }
    if (!createRepoId) {
      setCreateError('请选择绑定仓库')
      return
    }
    setCreateBusy(true)
    setCreateError(null)
    try {
      const next = await access.createAccessKey({ name, repoId: createRepoId })
      setDoc(next)
      setCreateOpen(false)
    } catch (e: any) {
      setCreateError(String(e?.message || e || '创建访问密钥失败'))
    } finally {
      setCreateBusy(false)
    }
  }, [access, createBusy, createName, createRepoId])

  const openEdit = React.useCallback(
    (entry: HyperCortexAccessKey) => {
      setEditTarget(entry)
      setEditName(entry.name)
      setEditRepoId(validRepoId(entry.repoId))
      setEditError(null)
    },
    [validRepoId],
  )

  const submitEdit = React.useCallback(async () => {
    const target = editTarget
    if (!target || editBusy) return
    const name = editName.trim()
    if (!name) {
      setEditError('名称不能为空')
      return
    }
    if (!editRepoId) {
      setEditError('请选择绑定仓库')
      return
    }
    setEditBusy(true)
    setEditError(null)
    try {
      const next = await access.updateAccessKey(target.key, { name, repoId: editRepoId })
      setDoc(next)
      setEditTarget(null)
    } catch (e: any) {
      setEditError(String(e?.message || e || '保存访问密钥失败'))
    } finally {
      setEditBusy(false)
    }
  }, [access, editBusy, editName, editRepoId, editTarget])

  const confirmDelete = React.useCallback(async () => {
    const target = deleteTarget
    if (!target || deleteBusy) return
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      const next = await access.deleteAccessKey(target.key)
      setDoc(next)
      setDeleteTarget(null)
    } catch (e: any) {
      setDeleteError(String(e?.message || e || '删除访问密钥失败'))
    } finally {
      setDeleteBusy(false)
    }
  }, [access, deleteBusy, deleteTarget])

  const toggleReveal = React.useCallback((key: string) => {
    setRevealedKeys(prev => ({ ...prev, [key]: !prev[key] }))
  }, [])

  const repoTitle = React.useCallback(
    (repoId: string) => repos.find(repo => repo.id === repoId)?.title || repoId,
    [repos],
  )

  const port = doc?.port || 0
  const keys = doc?.keys || []

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      <Typography sx={{ fontSize: 18, lineHeight: 1.25, fontWeight: 900, color: 'var(--hc-text)' }}>外部访问管理</Typography>
      <Typography sx={{ fontSize: 13, lineHeight: 1.6, color: 'var(--hc-text-muted)' }}>
        为外部工具开放访问入口：配置开放端口并创建访问密钥；每把密钥绑定一个仓库，外部工具凭访问地址与密钥只能访问该仓库的数据。
      </Typography>
      {loadError ? <Typography sx={{ fontSize: 12.5, color: 'var(--hc-danger)' }}>{loadError}</Typography> : null}

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, p: 1, borderRadius: 3, bgcolor: 'var(--hc-surface-soft)' }}>
        <Typography sx={{ fontSize: 13, fontWeight: 700, color: 'var(--hc-text)' }}>开放端口</Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <TextField
            size="small"
            type="number"
            placeholder={`${MIN_ACCESS_PORT} ~ ${MAX_ACCESS_PORT}`}
            value={portText}
            disabled={portBusy}
            onChange={event => setPortText(event.target.value)}
            onKeyDown={event => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              void savePort()
            }}
            inputProps={{ min: MIN_ACCESS_PORT, max: MAX_ACCESS_PORT, step: 1, style: { width: 110 } }}
            sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
          />
          <Button variant="text" size="small" onClick={() => void savePort()} disabled={portBusy} sx={softButtonSx}>
            {portBusy ? '保存中…' : '保存端口'}
          </Button>
        </Box>
        {portError ? <Typography sx={{ fontSize: 12.5, color: 'var(--hc-danger)' }}>{portError}</Typography> : null}
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, p: 1, borderRadius: 3, bgcolor: 'var(--hc-surface-soft)' }}>
        <Typography sx={{ fontSize: 13, fontWeight: 700, color: 'var(--hc-text)' }}>访问地址</Typography>
        <Typography sx={{ fontSize: 13, fontFamily: 'monospace', wordBreak: 'break-all', color: port > 0 ? 'var(--hc-text)' : 'var(--hc-text-subtle)' }}>
          {port > 0 ? `http://127.0.0.1:${port}` : '尚未配置开放端口'}
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, p: 1, borderRadius: 3, bgcolor: 'var(--hc-surface-soft)' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 700, color: 'var(--hc-text)' }}>访问密钥</Typography>
          <Button
            variant="text"
            size="small"
            startIcon={<AddRoundedIcon fontSize="small" />}
            onClick={openCreate}
            sx={{ ...softButtonSx, px: 1.5, flex: '0 0 auto' }}
          >
            新增密钥
          </Button>
        </Box>
        {keys.length === 0 ? (
          <Typography sx={{ px: 0.5, py: 1, fontSize: 13, color: 'var(--hc-text-muted)' }}>尚未创建访问密钥。</Typography>
        ) : (
          keys.map(entry => {
            const revealed = !!revealedKeys[entry.key]
            return (
              <Box
                key={entry.key}
                sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, px: 1, py: 0.75, borderRadius: 2, bgcolor: 'var(--hc-surface)' }}
              >
                <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                  <Typography noWrap sx={{ fontSize: 13.5, fontWeight: 700, color: 'var(--hc-text)' }}>
                    {entry.name || '未命名密钥'}
                  </Typography>
                  <Typography sx={{ fontSize: 12.5, fontFamily: 'monospace', wordBreak: 'break-all', color: revealed ? 'var(--hc-text)' : 'var(--hc-text-muted)' }}>
                    {revealed ? entry.key : MASKED_KEY_TEXT}
                  </Typography>
                  <Typography sx={{ fontSize: 12, color: 'var(--hc-text-subtle)' }}>
                    绑定仓库：{repoTitle(entry.repoId)} · 创建于 {formatDateTime(entry.createdAtMs) || '未知'}
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, flex: '0 0 auto' }}>
                  <Tooltip title={revealed ? '隐藏' : '显示'} placement="top">
                    <IconButton size="small" aria-label={`切换密钥显示 ${entry.name}`} onClick={() => toggleReveal(entry.key)}>
                      {revealed ? <VisibilityOffRoundedIcon fontSize="small" /> : <VisibilityRoundedIcon fontSize="small" />}
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="复制" placement="top">
                    <IconButton size="small" aria-label={`复制密钥 ${entry.name}`} onClick={() => onCopyKey(entry.key)}>
                      <ContentCopyRoundedIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="编辑" placement="top">
                    <IconButton size="small" aria-label={`编辑密钥 ${entry.name}`} onClick={() => openEdit(entry)}>
                      <EditRoundedIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="更多操作" placement="top">
                    <IconButton
                      size="small"
                      aria-label={`密钥操作 ${entry.name}`}
                      onClick={event => setMenuState({ anchorEl: event.currentTarget, entry })}
                    >
                      <MoreHorizRoundedIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Box>
              </Box>
            )
          })
        )}
      </Box>

      <Menu
        anchorEl={menuState?.anchorEl || null}
        open={workspaceVisible && !!menuState}
        onClose={() => setMenuState(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        PaperProps={{ sx: { ...menuPaperSx, minWidth: 160, mt: 0.5 } }}
      >
        <MenuItem
          disabled={!menuState}
          onClick={() => {
            const state = menuState
            setMenuState(null)
            if (!state) return
            setDeleteError(null)
            setDeleteTarget(state.entry)
          }}
          sx={{ ...menuDangerItemSx, borderRadius: 2, mx: 0.5 }}
        >
          <DeleteOutlineRoundedIcon sx={{ fontSize: 16, mr: 1 }} />
          删除
        </MenuItem>
      </Menu>

      <Dialog
        open={workspaceVisible && createOpen}
        onClose={createBusy ? undefined : () => setCreateOpen(false)}
        maxWidth="xs"
        fullWidth
        PaperProps={{ sx: { borderRadius: 7 } }}
      >
        <DialogTitle>新增访问密钥</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="名称"
            fullWidth
            value={createName}
            disabled={createBusy}
            onChange={event => setCreateName(event.target.value)}
            onKeyDown={event => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              void submitCreate()
            }}
          />
          <TextField
            select
            margin="dense"
            label="绑定仓库"
            fullWidth
            value={createRepoId}
            disabled={createBusy || repos.length === 0}
            onChange={event => setCreateRepoId(event.target.value)}
          >
            {repos.map(repo => (
              <MenuItem key={repo.id} value={repo.id}>{repo.title}</MenuItem>
            ))}
          </TextField>
          {createError ? <Typography sx={{ mt: 1, fontSize: 12.5, color: 'var(--hc-danger)' }}>{createError}</Typography> : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)} disabled={createBusy}>取消</Button>
          <Button variant="contained" onClick={() => void submitCreate()} disabled={createBusy || !createName.trim() || !createRepoId}>
            {createBusy ? '创建中…' : '创建'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={workspaceVisible && !!editTarget}
        onClose={editBusy ? undefined : () => setEditTarget(null)}
        maxWidth="xs"
        fullWidth
        PaperProps={{ sx: { borderRadius: 7 } }}
      >
        <DialogTitle>编辑访问密钥</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="名称"
            fullWidth
            value={editName}
            disabled={editBusy}
            onChange={event => setEditName(event.target.value)}
            onKeyDown={event => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              void submitEdit()
            }}
          />
          <TextField
            select
            margin="dense"
            label="绑定仓库"
            fullWidth
            value={editRepoId}
            disabled={editBusy || repos.length === 0}
            onChange={event => setEditRepoId(event.target.value)}
          >
            {repos.map(repo => (
              <MenuItem key={repo.id} value={repo.id}>{repo.title}</MenuItem>
            ))}
          </TextField>
          <Typography sx={{ mt: 1.25, fontSize: 12, lineHeight: 1.6, color: 'var(--hc-text-subtle)' }}>
            密钥本体与创建时间保持不变。
          </Typography>
          {editError ? <Typography sx={{ mt: 1, fontSize: 12.5, color: 'var(--hc-danger)' }}>{editError}</Typography> : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditTarget(null)} disabled={editBusy}>取消</Button>
          <Button variant="contained" onClick={() => void submitEdit()} disabled={editBusy || !editName.trim() || !editRepoId}>
            {editBusy ? '保存中…' : '保存'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={workspaceVisible && !!deleteTarget}
        onClose={deleteBusy ? undefined : () => setDeleteTarget(null)}
        maxWidth="xs"
        fullWidth
        PaperProps={{ sx: { borderRadius: 7 } }}
      >
        <DialogTitle>删除访问密钥</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 13, lineHeight: 1.7, color: 'var(--hc-text)' }}>
            确定删除密钥「{deleteTarget?.name || '未命名密钥'}」吗？删除后不可恢复。
          </Typography>
          {deleteError ? <Typography sx={{ mt: 1, fontSize: 12.5, color: 'var(--hc-danger)' }}>{deleteError}</Typography> : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)} disabled={deleteBusy}>取消</Button>
          <Button variant="contained" color="error" onClick={() => void confirmDelete()} disabled={deleteBusy}>
            {deleteBusy ? '删除中…' : '删除'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
