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
import type { AppDisplayMode, RegisteredApp, RegisteredAppCommand, RegisteredAppUpdatePatch } from './types'
import AppCardView from './AppCardView'
import AppCommandEditor from './AppCommandEditor'
import { getAppStatus, stopApp } from './appLauncher'
import { generateSafeId } from './ids'
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

type RemoveConfirmStep = 'remove' | 'stop-running'

type RemoveConfirmState = {
  app: RegisteredApp
  step: RemoveConfirmStep
} | null

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
  const [icon, setIcon] = useState('')
  const [hotkey, setHotkey] = useState('')
  const [hotkeyRecording, setHotkeyRecording] = useState(false)
  const [displayMode, setDisplayMode] = useState<AppDisplayMode>('default')
  const [commands, setCommands] = useState<RegisteredAppCommand[]>([])
  const [availableCommands, setAvailableCommands] = useState<RegisteredAppCommand[]>([])
  const [saving, setSaving] = useState(false)
  const [pickingPath, setPickingPath] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [removeConfirm, setRemoveConfirm] = useState<RemoveConfirmState>(null)

  const openAdd = () => {
    setHotkeyRecording(false)
    setEditingId(null)
    setName('')
    setPath('')
    setIcon('')
    setHotkey('')
    setDisplayMode('default')
    setCommands([])
    setAvailableCommands([])
    setPickingPath(false)
    setEditOpen(true)
  }

  const openEdit = (app: RegisteredApp) => {
    setHotkeyRecording(false)
    setEditingId(app.id)
    setName(app.name)
    setPath(app.path)
    setIcon(app.icon || '')
    setHotkey(app.hotkey ?? '')
    setDisplayMode(app.displayMode)
    setCommands(Array.isArray(app.commands) ? app.commands : [])
    setAvailableCommands(Array.isArray(app.availableCommands) ? app.availableCommands : [])
    setPickingPath(false)
    setEditOpen(true)
  }

  const pickExecutablePath = async () => {
    setPickingPath(true)
    try {
      const picked = await invoke<string | null>('host_dialog_pick_app_executable')
      if (!picked) return
      setPath(picked)
      const nextIcon = await readAppIcon(picked)
      if (nextIcon) setIcon(nextIcon)
    } catch (error: any) {
      await hostToast(String(error?.message || error || '选择应用文件失败'))
    } finally {
      setPickingPath(false)
    }
  }

  const normalizedCommands = () => commands
    .map(command => ({ ...command, title: command.title.trim() }))
    .filter(command => command.id.trim() && command.title)

  const openRemoveConfirm = (app: RegisteredApp) => {
    setRemoveConfirm({ app, step: 'remove' })
  }

  const closeRemoveConfirm = () => {
    if (removingId) return
    setRemoveConfirm(null)
  }

  const removeRegisteredAppSafely = async (app: RegisteredApp, stopRunning: boolean) => {
    setRemovingId(app.id)
    try {
      const status = await getAppStatus(app.id).catch(() => null)
      if (status?.running) {
        if (!stopRunning) {
          setRemoveConfirm({ app, step: 'stop-running' })
          return
        }
        await stopApp(app.id)
      }
      await onRemove(app.id)
      await hostToast(`已取消注册：${app.name}`)
      setRemoveConfirm(null)
    } catch (error: any) {
      await hostToast(String(error?.message || error || '取消注册失败'))
    } finally {
      setRemovingId(null)
    }
  }

  const save = async () => {
    const n = name.trim()
    const p = path.trim()
    if (!n || !p) return

    setSaving(true)
    try {
      const id = editingId ?? generateSafeId(n)
      const existingApp = editingId ? apps.find(app => app.id === editingId) : null
      const nextIcon = await readAppIcon(p) || icon || existingApp?.icon || ''
      const nextHotkey = hotkey.trim()
      const nextCommands = normalizedCommands()

      if (editingId) {
        await onUpdate(editingId, { name: n, path: p, icon: nextIcon, hotkey: nextHotkey || null, displayMode, commands: nextCommands })
      } else {
        await onAdd({
          id,
          name: n,
          icon: nextIcon,
          path: p,
          hotkey: nextHotkey || undefined,
          displayMode,
          commands: nextCommands,
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
                onClick={() => openRemoveConfirm(app)}
                aria-label={`移除 ${app.name}`}
                disabled={removingId === app.id}
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
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <TextField label="可执行文件路径" value={path} onChange={e => setPath(e.target.value)} size="small" fullWidth placeholder="C:\Apps\my-app\app.exe" />
            <Button variant="outlined" onClick={() => void pickExecutablePath()} disabled={pickingPath || saving} sx={{ flexShrink: 0 }}>
              {pickingPath ? '选择中…' : '选择文件'}
            </Button>
          </Box>
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
          <AppCommandEditor commands={commands} availableCommands={availableCommands} onChange={setCommands} />
        </DialogContent>
        <DialogActions>
          <Button disabled={saving} onClick={() => { setHotkeyRecording(false); setEditOpen(false) }}>取消</Button>
          <Button disabled={saving} onClick={() => void save()} variant="contained" sx={{ boxShadow: 'none' }}>保存</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!removeConfirm} onClose={closeRemoveConfirm} fullWidth maxWidth="xs">
        <DialogTitle>{removeConfirm?.step === 'stop-running' ? '停止并取消注册' : '取消注册应用'}</DialogTitle>
        <DialogContent sx={{ pt: '8px !important' }}>
          <Typography variant="body2" sx={{ fontWeight: 700, mb: 1 }}>
            {removeConfirm ? `「${removeConfirm.app.name}」` : ''}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {removeConfirm?.step === 'stop-running'
              ? '这个应用正在运行。取消注册前需要先停止它，然后再从 Fast Window 的注册列表中移除。磁盘上的应用文件不会被删除。'
              : '确定要从 Fast Window 取消注册这个应用吗？这只会移除注册记录，不会删除磁盘上的应用文件。'}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button disabled={!!removingId} onClick={closeRemoveConfirm}>取消</Button>
          <Button
            disabled={!!removingId || !removeConfirm}
            color="error"
            variant="contained"
            onClick={() => removeConfirm && void removeRegisteredAppSafely(removeConfirm.app, removeConfirm.step === 'stop-running')}
            sx={{ boxShadow: 'none' }}
          >
            {removeConfirm?.step === 'stop-running' ? '停止并取消注册' : '取消注册'}
          </Button>
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
