import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import {
  Box, Typography, IconButton, Button,
  Dialog, DialogTitle, DialogContent, DialogActions,
  Stack, TextField, ToggleButtonGroup, ToggleButton,
} from '@mui/material'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import type { AppDisplayMode, RegisteredApp, RegisteredAppUpdatePatch } from './types'
import AppCardView from './AppCardView'
import { hostToast } from '../host/hostPrimitives'
import { buildShortcutFromEvent, pauseShortcutRecordingGuards, resumeShortcutRecordingGuards } from '../shortcuts'

interface AppRegistrationPanelProps {
  apps: RegisteredApp[]
  onAdd: (app: RegisteredApp) => void | Promise<void>
  onRemove: (id: string) => void | Promise<void>
  onUpdate: (id: string, patch: RegisteredAppUpdatePatch) => void | Promise<void>
  onClose?: () => void
  embedded?: boolean
}

function generateId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32) || 'untitled'
}

async function readAppIcon(path: string) {
  try {
    return await invoke<string>('app_icon_data_url', { exePath: path })
  } catch (error) {
    console.warn('[app] failed to read app icon:', error)
    return ''
  }
}

export default function AppRegistrationPanel({ apps, onAdd, onRemove, onUpdate, onClose, embedded }: AppRegistrationPanelProps) {
  const [editOpen, setEditOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const [hotkey, setHotkey] = useState('')
  const [hotkeyRecording, setHotkeyRecording] = useState(false)
  const [displayMode, setDisplayMode] = useState<AppDisplayMode>('default')
  const [saving, setSaving] = useState(false)

  const openAdd = () => {
    setHotkeyRecording(false)
    setEditingId(null)
    setName('')
    setPath('')
    setHotkey('')
    setDisplayMode('default')
    setEditOpen(true)
  }

  const openEdit = (app: RegisteredApp) => {
    setHotkeyRecording(false)
    setEditingId(app.id)
    setName(app.name)
    setPath(app.path)
    setHotkey(app.hotkey ?? '')
    setDisplayMode(app.displayMode)
    setEditOpen(true)
  }

  const save = async () => {
    const n = name.trim()
    const p = path.trim()
    if (!n || !p) return

    setSaving(true)
    try {
      const id = editingId ?? generateId(n)
      const icon = await readAppIcon(p)
      const nextHotkey = hotkey.trim()

      if (editingId) {
        await onUpdate(editingId, { name: n, path: p, icon, hotkey: nextHotkey || null, displayMode })
      } else {
        await onAdd({
          id,
          name: n,
          icon,
          path: p,
          hotkey: nextHotkey || undefined,
          displayMode,
          commands: [],
          autoStart: false,
        })
      }
      setHotkeyRecording(false)
      setEditOpen(false)
    } catch (error: any) {
      await hostToast(String(error?.message || error || '保存应用失败'))
    } finally {
      setSaving(false)
    }
  }

  const startHotkeyRecording = () => {
    setHotkeyRecording(true)
  }

  const saveHotkey = (next: string) => {
    setHotkey(next)
    setHotkeyRecording(false)
  }

  const cancelHotkeyRecording = () => {
    setHotkeyRecording(false)
  }

  useEffect(() => {
    if (!hotkeyRecording) return

    pauseShortcutRecordingGuards()

    return () => {
      resumeShortcutRecordingGuards()
    }
  }, [hotkeyRecording])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!hotkeyRecording) return
    e.preventDefault()
    e.stopPropagation()
    ;(e as any).stopImmediatePropagation?.()

    if (e.key === 'Escape') {
      cancelHotkeyRecording()
      return
    }

    if (e.repeat) return
    const shot = buildShortcutFromEvent(e.nativeEvent)
    if (!shot) return
    saveHotkey(shot)
  }

  const content = (
    <>
      {embedded ? (
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1, mb: 1.25 }}>
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 700 }}>
              应用注册
            </Typography>
            <Typography variant="caption" color="text.secondary">
              管理可由 Fast Window 启动和唤醒的 v5 独立应用。
            </Typography>
          </Box>
          <Button onClick={openAdd} variant="contained" size="small" sx={{ boxShadow: 'none', flexShrink: 0 }}>
            添加应用
          </Button>
        </Box>
      ) : null}

      <Box>
        {apps.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
            暂无注册应用
          </Typography>
        ) : (
          apps.map(app => (
            <Box key={app.id} sx={{ display: 'flex', alignItems: 'center' }}>
              <Box sx={{ flex: 1 }}>
                <AppCardView app={app} />
              </Box>
              <IconButton
                size="small"
                onClick={() => openEdit(app)}
                aria-label={`编辑 ${app.name}`}
              >
                <EditRoundedIcon fontSize="small" />
              </IconButton>
              <IconButton
                size="small"
                onClick={() => onRemove(app.id)}
                aria-label={`移除 ${app.name}`}
              >
                <DeleteRoundedIcon fontSize="small" />
              </IconButton>
            </Box>
          ))
        )}
      </Box>

      <Dialog open={editOpen} onClose={() => { setHotkeyRecording(false); setEditOpen(false) }} fullWidth maxWidth="xs">
        <DialogTitle>{editingId ? '编辑应用' : '添加应用'}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }} onKeyDown={onKeyDown}>
          <TextField label="名称" value={name} onChange={e => setName(e.target.value)} size="small" fullWidth />
          <TextField label="可执行文件路径" value={path} onChange={e => setPath(e.target.value)} size="small" fullWidth placeholder="C:\Apps\my-app\app.exe" />
          <TextField
            label="快捷键（可选）"
            value={hotkey}
            size="small"
            fullWidth
            placeholder="点击录制然后按键"
            InputProps={{ readOnly: true }}
            helperText={hotkeyRecording ? '录制中…按 ESC 取消，按下组合键即可保存到输入框里。' : '点击开始录制，然后按下组合键。'}
          />
          <Stack direction="row" spacing={1}>
            <Button variant={hotkeyRecording ? 'contained' : 'outlined'} color={hotkeyRecording ? 'warning' : 'primary'} onClick={hotkeyRecording ? cancelHotkeyRecording : startHotkeyRecording}>
              {hotkeyRecording ? '录制中…' : '开始录制'}
            </Button>
            <Button variant="outlined" onClick={() => setHotkey('')}>
              清空快捷键
            </Button>
          </Stack>
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>显示模式</Typography>
            <ToggleButtonGroup
              value={displayMode}
              exclusive
              onChange={(_, v) => v && setDisplayMode(v)}
              size="small"
            >
              <ToggleButton value="default">默认</ToggleButton>
              <ToggleButton value="window">窗口</ToggleButton>
              <ToggleButton value="top">置顶</ToggleButton>
            </ToggleButtonGroup>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button disabled={saving} onClick={() => { setHotkeyRecording(false); setEditOpen(false) }}>取消</Button>
          <Button disabled={saving} onClick={() => void save()} variant="contained" sx={{ boxShadow: 'none' }}>保存</Button>
        </DialogActions>
      </Dialog>
    </>
  )

  if (embedded) {
    return <Box>{content}</Box>
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ pr: 6 }}>
        注册管理
        <IconButton aria-label="关闭" onClick={onClose} sx={{ position: 'absolute', right: 8, top: 8 }} size="small">
          <CloseRoundedIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent>{content}</DialogContent>
      <DialogActions>
        <Button onClick={openAdd} variant="contained" size="small" sx={{ boxShadow: 'none' }}>
          添加应用
        </Button>
      </DialogActions>
    </Dialog>
  )
}
