import * as React from 'react'
import { Box, Button, CircularProgress, DialogActions, DialogContent, DialogTitle, IconButton, Stack, TextField, Typography } from '@mui/material'
import { DependableDialog } from '../components/DependableOverlay'
import AddIcon from '@mui/icons-material/Add'
import CloseIcon from '@mui/icons-material/Close'
import DeleteIcon from '@mui/icons-material/Delete'
import EditIcon from '@mui/icons-material/Edit'
import SaveIcon from '@mui/icons-material/Save'
import type { Shelf, ShelfOutcome } from '../../domain/release'

type ShelfManagerDialogProps = {
  open: boolean
  onClose: () => void
  shelves: Shelf[]
  addShelf?: (name: string, path: string) => Promise<ShelfOutcome | null | undefined>
  updateShelf?: (name: string, newName?: string, newPath?: string) => Promise<ShelfOutcome | null | undefined>
  removeShelf?: (name: string) => Promise<ShelfOutcome | null | undefined>
  onChanged: () => Promise<void> | void
}

type EditingField = { name: string; field: 'name' | 'path' }

// ShelfManagerDialog 是货架注册表的管理入口：注册、改名、改路径、删除；
// 失败原因由业务端返回并原样展示。
export function ShelfManagerDialog(props: ShelfManagerDialogProps) {
  const { open, onClose, shelves, addShelf, updateShelf, removeShelf, onChanged } = props
  const [name, setName] = React.useState('')
  const [path, setPath] = React.useState('')
  const [editing, setEditing] = React.useState<EditingField | null>(null)
  const [editValue, setEditValue] = React.useState('')
  const [error, setError] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setName('')
    setPath('')
    setEditing(null)
    setEditValue('')
    setError('')
    setBusy(false)
  }, [open])

  const run = async (action: () => Promise<ShelfOutcome | null | undefined> | undefined): Promise<boolean> => {
    setBusy(true)
    setError('')
    try {
      const outcome = await Promise.resolve(action())
      if (!outcome || !outcome.ok) {
        setError(outcome?.error || '货架操作失败')
        return false
      }
      await Promise.resolve(onChanged()).catch(() => {})
      return true
    } finally {
      setBusy(false)
    }
  }

  const canAdd = name.trim() !== '' && path.trim() !== '' && !busy

  const submitAdd = async () => {
    if (!canAdd) return
    const done = await run(() => addShelf?.(name.trim(), path.trim()))
    if (done) {
      setName('')
      setPath('')
    }
  }

  const startEdit = (shelf: Shelf, field: 'name' | 'path') => {
    setEditing({ name: shelf.name, field })
    setEditValue(field === 'name' ? shelf.name : shelf.path)
    setError('')
  }

  const submitEdit = async () => {
    if (!editing || busy) return
    const value = editValue.trim()
    if (value === '') {
      setError(editing.field === 'name' ? '货架名字不能为空' : '货架路径不能为空')
      return
    }
    const done = editing.field === 'name'
      ? await run(() => updateShelf?.(editing.name, value))
      : await run(() => updateShelf?.(editing.name, undefined, value))
    if (done) setEditing(null)
  }

  const submitRemove = (shelf: Shelf) => {
    if (busy) return
    void run(() => removeShelf?.(shelf.name))
  }

  return (
    <DependableDialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        管理货架
        <Box sx={{ flex: 1 }} />
        <IconButton onClick={onClose} size="small" aria-label="关闭货架管理" disabled={busy}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={1.25}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
            <TextField
              size="small"
              label="货架名字"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={busy}
              sx={{ flex: 1 }}
            />
            <TextField
              size="small"
              label="货架路径"
              value={path}
              onChange={(event) => setPath(event.target.value)}
              disabled={busy}
              sx={{ flex: 2 }}
            />
            <Button size="small" variant="contained" startIcon={<AddIcon />} disabled={!canAdd} onClick={() => void submitAdd()}>
              注册
            </Button>
          </Stack>
          {shelves.length ? (
            shelves.map((shelf) => (
              <Box key={shelf.name} sx={{ p: 1.1, borderRadius: 2, bgcolor: 'background.paper' }}>
                <Stack spacing={0.5}>
                  {editing?.name === shelf.name ? (
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
                      <TextField
                        size="small"
                        label={editing.field === 'name' ? '新名字' : '新路径'}
                        value={editValue}
                        onChange={(event) => setEditValue(event.target.value)}
                        disabled={busy}
                        sx={{ flex: 1 }}
                      />
                      <Stack direction="row" spacing={0.5}>
                        <Button size="small" variant="contained" startIcon={<SaveIcon />} disabled={busy} onClick={() => void submitEdit()}>
                          保存
                        </Button>
                        <Button size="small" variant="text" disabled={busy} onClick={() => setEditing(null)}>
                          取消
                        </Button>
                      </Stack>
                    </Stack>
                  ) : (
                    <>
                      <Stack direction="row" spacing={0.5} alignItems="center">
                        <Typography variant="body2" sx={{ fontWeight: 900, flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
                          {shelf.name}
                        </Typography>
                        <Button size="small" startIcon={<EditIcon />} disabled={busy} onClick={() => startEdit(shelf, 'name')}>
                          改名
                        </Button>
                        <Button size="small" startIcon={<EditIcon />} disabled={busy} onClick={() => startEdit(shelf, 'path')}>
                          改路径
                        </Button>
                        <Button size="small" color="warning" startIcon={<DeleteIcon />} disabled={busy} onClick={() => submitRemove(shelf)}>
                          删除
                        </Button>
                      </Stack>
                      <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                        {shelf.path}
                      </Typography>
                    </>
                  )}
                </Stack>
              </Box>
            ))
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: 'center' }}>
              还没有注册货架。填写名字与路径即可注册第一个货架。
            </Typography>
          )}
          {error ? (
            <Typography variant="caption" color="error" sx={{ overflowWrap: 'anywhere' }}>
              {error}
            </Typography>
          ) : null}
          {busy ? (
            <Stack direction="row" spacing={1} alignItems="center">
              <CircularProgress size={14} />
              <Typography variant="caption" color="text.secondary">正在应用货架变更…</Typography>
            </Stack>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Typography variant="caption" color="text.secondary" sx={{ mr: 'auto', pl: 1 }}>
          货架路径的存放位置由主人自己负责；业务端只保存名字与路径，读取失败会如实报告。
        </Typography>
        <Button onClick={onClose} disabled={busy}>关闭</Button>
      </DialogActions>
    </DependableDialog>
  )
}
