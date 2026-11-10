import * as React from 'react'
import { Box, Button, CircularProgress, DialogActions, DialogContent, DialogTitle, IconButton, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import { DependableDialog } from '../components/DependableOverlay'
import AddIcon from '@mui/icons-material/Add'
import CloseIcon from '@mui/icons-material/Close'
import DeleteIcon from '@mui/icons-material/Delete'
import EditIcon from '@mui/icons-material/Edit'
import SaveIcon from '@mui/icons-material/Save'
import type { ReleaseSource, ReleaseSourceProvider, SourceOutcome } from '../../domain/release'

type SourcePatch = { newName?: string; newKind?: ReleaseSourceProvider; newPath?: string; newIndexUrl?: string }

type SourceManagerDialogProps = {
  open: boolean
  onClose: () => void
  sources: ReleaseSource[]
  addSource?: (source: ReleaseSource) => Promise<SourceOutcome | null | undefined>
  updateSource?: (name: string, patch: SourcePatch) => Promise<SourceOutcome | null | undefined>
  removeSource?: (name: string) => Promise<SourceOutcome | null | undefined>
  onChanged: () => Promise<void> | void
}

// 编辑焦点：名字、本机路径、清单网址；switchKind 表示这次保存同时切换提供方式。
type EditingField = { name: string; field: 'name' | 'path' | 'indexUrl'; switchKind?: ReleaseSourceProvider }

// SourceManagerDialog 是商店来源注册表的管理入口：注册、改名、切换提供方式、改位置、删除。
// 失败原因由业务端返回并原样展示。
export function SourceManagerDialog(props: SourceManagerDialogProps) {
  const { open, onClose, sources, addSource, updateSource, removeSource, onChanged } = props
  const [name, setName] = React.useState('')
  const [kind, setKind] = React.useState<ReleaseSourceProvider>('shelf')
  const [location, setLocation] = React.useState('')
  const [editing, setEditing] = React.useState<EditingField | null>(null)
  const [editValue, setEditValue] = React.useState('')
  const [error, setError] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setName('')
    setKind('shelf')
    setLocation('')
    setEditing(null)
    setEditValue('')
    setError('')
    setBusy(false)
  }, [open])

  const run = async (action: () => Promise<SourceOutcome | null | undefined> | undefined): Promise<boolean> => {
    setBusy(true)
    setError('')
    try {
      const outcome = await Promise.resolve(action())
      if (!outcome || !outcome.ok) {
        setError(outcome?.error || '商店来源操作失败')
        return false
      }
      await Promise.resolve(onChanged()).catch(() => {})
      return true
    } finally {
      setBusy(false)
    }
  }

  const canAdd = name.trim() !== '' && location.trim() !== '' && !busy

  const submitAdd = async () => {
    if (!canAdd) return
    const source: ReleaseSource = {
      name: name.trim(),
      kind,
      ...(kind === 'shelf' ? { path: location.trim() } : { indexUrl: location.trim() }),
    }
    const done = await run(() => addSource?.(source))
    if (done) {
      setName('')
      setLocation('')
    }
  }

  const startEdit = (source: ReleaseSource, field: 'name' | 'path' | 'indexUrl', switchKind?: ReleaseSourceProvider) => {
    setEditing({ name: source.name, field, switchKind })
    setEditValue(field === 'name' ? source.name : '')
    setError('')
  }

  const submitEdit = async () => {
    if (!editing || busy) return
    const value = editValue.trim()
    if (value === '') {
      setError(editing.field === 'name' ? '来源名字不能为空' : editing.field === 'path' ? '本机路径不能为空' : '清单网址不能为空')
      return
    }
    const patch: SourcePatch = {}
    if (editing.switchKind) {
      patch.newKind = editing.switchKind
      if (editing.switchKind === 'shelf') patch.newPath = value
      else patch.newIndexUrl = value
    } else if (editing.field === 'name') {
      patch.newName = value
    } else if (editing.field === 'path') {
      patch.newPath = value
    } else {
      patch.newIndexUrl = value
    }
    const done = await run(() => updateSource?.(editing.name, patch))
    if (done) setEditing(null)
  }

  const submitRemove = (source: ReleaseSource) => {
    if (busy) return
    void run(() => removeSource?.(source.name))
  }

  const editLabel = editing?.switchKind
    ? editing.switchKind === 'shelf' ? '新本机路径' : '新清单网址'
    : editing?.field === 'name' ? '新名字' : editing?.field === 'path' ? '新本机路径' : '新清单网址'

  return (
    <DependableDialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        管理商店来源
        <Box sx={{ flex: 1 }} />
        <IconButton onClick={onClose} size="small" aria-label="关闭来源管理" disabled={busy}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={1.25}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
            <TextField
              size="small"
              label="来源名字"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={busy}
              sx={{ flex: 1 }}
            />
            <ToggleButtonGroup
              size="small"
              exclusive
              value={kind}
              onChange={(_event, next) => { if (next) setKind(next as ReleaseSourceProvider) }}
              disabled={busy}
            >
              <ToggleButton value="shelf">本机</ToggleButton>
              <ToggleButton value="remote">网络</ToggleButton>
            </ToggleButtonGroup>
            <TextField
              size="small"
              label={kind === 'shelf' ? '本机目录' : '清单网址'}
              value={location}
              onChange={(event) => setLocation(event.target.value)}
              disabled={busy}
              sx={{ flex: 2 }}
            />
            <Button size="small" variant="contained" startIcon={<AddIcon />} disabled={!canAdd} onClick={() => void submitAdd()}>
              注册
            </Button>
          </Stack>
          {sources.length ? (
            sources.map((source) => (
              <Box key={source.name} sx={{ p: 1.1, borderRadius: 2, bgcolor: 'background.paper' }}>
                <Stack spacing={0.5}>
                  {editing?.name === source.name ? (
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
                      <TextField
                        size="small"
                        label={editLabel}
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
                          {source.name}
                        </Typography>
                        <Button size="small" startIcon={<EditIcon />} disabled={busy} onClick={() => startEdit(source, 'name')}>
                          改名
                        </Button>
                        <Button size="small" startIcon={<EditIcon />} disabled={busy} onClick={() => startEdit(source, source.kind === 'shelf' ? 'path' : 'indexUrl')}>
                          {source.kind === 'shelf' ? '改路径' : '改网址'}
                        </Button>
                        <Button
                          size="small"
                          disabled={busy}
                          onClick={() => startEdit(source, source.kind === 'shelf' ? 'indexUrl' : 'path', source.kind === 'shelf' ? 'remote' : 'shelf')}
                        >
                          {source.kind === 'shelf' ? '改为网络' : '改为本机'}
                        </Button>
                        <Button size="small" color="warning" startIcon={<DeleteIcon />} disabled={busy} onClick={() => submitRemove(source)}>
                          删除
                        </Button>
                      </Stack>
                      <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                        {source.kind === 'shelf' ? '本机目录' : '网络商店'} · {source.kind === 'shelf' ? source.path : source.indexUrl}
                      </Typography>
                    </>
                  )}
                </Stack>
              </Box>
            ))
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: 'center' }}>
              还没有注册来源。注册本机目录或网络商店后即可切换展示。
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
              <Typography variant="caption" color="text.secondary">正在应用来源变更…</Typography>
            </Stack>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Typography variant="caption" color="text.secondary" sx={{ mr: 'auto', pl: 1 }}>
          网络来源请填写清单文件的完整网址；清单与压缩包需放在同一台服务器上，读取失败会如实报告。
        </Typography>
        <Button onClick={onClose} disabled={busy}>关闭</Button>
      </DialogActions>
    </DependableDialog>
  )
}
