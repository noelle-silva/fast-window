import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import {
  Alert, Box, Typography, IconButton, Button, CircularProgress,
  Dialog, DialogTitle, DialogContent, DialogActions,
  FormControlLabel, Stack, Switch, TextField, ToggleButtonGroup, ToggleButton, Menu, MenuItem,
} from '@mui/material'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded'
import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded'
import type { AppDisplayMode, AppHotkeyLaunchBehavior, AppRegistrationEditRequest, RegisteredApp, RegisteredAppCommand, RegisteredAppUpdatePatch } from './types'
import AppCardView from './AppCardView'
import AppCommandEditor from './AppCommandEditor'
import AppIconEditor from './AppIconEditor'
import { getAppStatus } from './appLauncher'
import { appStopToastMessage, stopRegisteredApp } from './appStop'
import { inspectInstalledApp } from './installedAppInfo'
import { listAppCapabilities, type AppCapabilityLaunchPolicy } from './appCapabilities'
import { hostToast } from '../host/hostPrimitives'
import { buildShortcutFromEvent, pauseShortcutRecordingGuards, resumeShortcutRecordingGuards } from '../shortcuts'
import { readIconImageDataUrl, type IconImageSource } from '../iconImageInput'
import { hostButtonSx, hostDangerButtonSx, hostTextFieldSx, hostToggleGroupSx } from '../components/hostUiStyles'

interface AppRegistrationPanelProps {
  apps: RegisteredApp[]
  onAdd: (app: RegisteredApp) => void | Promise<void>
  onReplace: (previousId: string, app: RegisteredApp) => void | Promise<void>
  onRemove: (id: string) => void | Promise<void>
  onUpdate: (id: string, patch: RegisteredAppUpdatePatch) => void | Promise<void>
  onClose?: () => void
  embedded?: boolean
  editRequest?: AppRegistrationEditRequest | null
  onEditRequestHandled?: (requestId: number) => void
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

export default function AppRegistrationPanel({
  apps,
  onAdd,
  onReplace,
  onRemove,
  onUpdate,
  onClose,
  embedded,
  editRequest,
  onEditRequestHandled,
}: AppRegistrationPanelProps) {
  const [editOpen, setEditOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const [icon, setIcon] = useState('')
  const [iconChanging, setIconChanging] = useState(false)
  const [changingCommandIconId, setChangingCommandIconId] = useState<string | null>(null)
  const [hotkey, setHotkey] = useState('')
  const [hotkeyLaunchBehavior, setHotkeyLaunchBehavior] = useState<AppHotkeyLaunchBehavior>('launch')
  const [hotkeyRecording, setHotkeyRecording] = useState(false)
  const [recordingCommandHotkeyId, setRecordingCommandHotkeyId] = useState<string | null>(null)
  const [displayMode, setDisplayMode] = useState<AppDisplayMode>('default')
  const [autoStart, setAutoStart] = useState(false)
  const [commands, setCommands] = useState<RegisteredAppCommand[]>([])
  const [currentCommands, setCurrentCommands] = useState<RegisteredAppCommand[]>([])
  const [currentCommandsLoading, setCurrentCommandsLoading] = useState(false)
  const [currentCommandsError, setCurrentCommandsError] = useState('')
  const [commandsEdited, setCommandsEdited] = useState(false)
  const [saving, setSaving] = useState(false)
  const [pickingPath, setPickingPath] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [removeConfirm, setRemoveConfirm] = useState<RemoveConfirmState>(null)
  const [editMenuAnchorEl, setEditMenuAnchorEl] = useState<HTMLElement | null>(null)
  const handledEditRequestIdRef = useRef<number | null>(null)

  const editingApp = editingId ? apps.find(app => app.id === editingId) ?? null : null

  const closeEditMenu = () => {
    setEditMenuAnchorEl(null)
  }

  const closeEditDialog = () => {
    setHotkeyRecording(false)
    setRecordingCommandHotkeyId(null)
    setChangingCommandIconId(null)
    closeEditMenu()
    setEditOpen(false)
  }

  const openAdd = () => {
    setHotkeyRecording(false)
    setEditingId(null)
    setName('')
    setPath('')
    setIcon('')
    setIconChanging(false)
    setChangingCommandIconId(null)
    setHotkey('')
    setHotkeyLaunchBehavior('launch')
    setRecordingCommandHotkeyId(null)
    setDisplayMode('default')
    setAutoStart(false)
    setCommands([])
    setCurrentCommands([])
    setCurrentCommandsError('')
    setCurrentCommandsLoading(false)
    setCommandsEdited(false)
    setPickingPath(false)
    closeEditMenu()
    setEditOpen(true)
  }

  const openEdit = (app: RegisteredApp) => {
    setHotkeyRecording(false)
    setEditingId(app.id)
    setName(app.name)
    setPath(app.path)
    setIcon(app.icon || '')
    setIconChanging(false)
    setChangingCommandIconId(null)
    setHotkey(app.hotkey ?? '')
    setHotkeyLaunchBehavior(app.hotkeyLaunchBehavior ?? 'launch')
    setRecordingCommandHotkeyId(null)
    setDisplayMode(app.displayMode)
    setAutoStart(app.autoStart)
    setCommands(Array.isArray(app.commands) ? app.commands : [])
    setCurrentCommands([])
    setCurrentCommandsError('')
    setCurrentCommandsLoading(false)
    setCommandsEdited(true)
    setPickingPath(false)
    closeEditMenu()
    setEditOpen(true)
    void refreshCurrentCommands(app)
  }

  const refreshCurrentCommands = async (app: RegisteredApp, launchPolicy: AppCapabilityLaunchPolicy = 'runningOnly') => {
    setCurrentCommandsLoading(true)
    setCurrentCommandsError('')
    try {
      const result = await listAppCapabilities([app], { launchPolicy })
      const hit = result.apps.find(item => item.appId === app.id)
      const error = result.errors.find(item => item.appId === app.id)
      setCurrentCommands(Array.isArray(hit?.commands) ? hit.commands : [])
      setCurrentCommandsError(error?.message || '')
    } catch (error: any) {
      setCurrentCommands([])
      setCurrentCommandsError(String(error?.message || error || '读取应用当前命令失败'))
    } finally {
      setCurrentCommandsLoading(false)
    }
  }

  const refreshCurrentCommandsFromCurrentPath = async () => {
    const p = path.trim()
    if (!p) return
    try {
      const info = await inspectInstalledApp(p)
      const nextIcon = icon || info.icon || await readAppIcon(info.path)
      await refreshCurrentCommands({
        id: info.id,
        name: name.trim() || info.name,
        icon: nextIcon,
        path: info.path,
        version: info.version,
        displayMode,
        commands: normalizedCommands(),
        autoStart,
      }, 'allowLaunch')
    } catch (error: any) {
      setCurrentCommands([])
      setCurrentCommandsError(String(error?.message || error || '读取应用当前命令失败'))
    }
  }

  useEffect(() => {
    if (!editRequest) return
    if (handledEditRequestIdRef.current === editRequest.requestId) return
    const app = apps.find(item => item.id === editRequest.appId)
    if (!app) return
    handledEditRequestIdRef.current = editRequest.requestId
    openEdit(app)
    onEditRequestHandled?.(editRequest.requestId)
  }, [apps, editRequest, onEditRequestHandled])

  const pickExecutablePath = async () => {
    setPickingPath(true)
    try {
      const picked = await invoke<string | null>('host_dialog_pick_app_executable')
      if (!picked) return
      const info = await inspectInstalledApp(picked)
      const nextIcon = info.icon || await readAppIcon(info.path)
      setName(info.name)
      setPath(info.path)
      setIcon(nextIcon)
      setDisplayMode(info.displayMode)
      setCommands([])
      setCurrentCommands([])
      setCurrentCommandsError('已选择应用；如需读取当前命令，请点击“启动并读取当前命令”。')
      setCommandsEdited(true)
    } catch (error: any) {
      await hostToast(String(error?.message || error || '选择的文件不是有效 v5 应用'))
    } finally {
      setPickingPath(false)
    }
  }

  const normalizedCommands = () => commands
    .map(command => ({
      ...command,
      id: command.id.trim(),
      title: command.title.trim(),
      icon: command.icon?.trim() || undefined,
      hotkey: command.hotkey?.trim() || undefined,
    }))
    .filter(command => command.id && command.title)

  const changeIcon = async (source: IconImageSource) => {
    setIconChanging(true)
    try {
      const dataUrl = await readIconImageDataUrl(source)
      if (!dataUrl) return
      setIcon(dataUrl)
      await hostToast('图标已更新，保存后生效')
    } catch (error: any) {
      await hostToast(String(error?.message || error || '更改图标失败'))
    } finally {
      setIconChanging(false)
    }
  }

  const resetIconToDefault = async () => {
    const p = path.trim()
    if (!p) {
      await hostToast('请先选择可执行文件')
      return
    }

    setIconChanging(true)
    try {
      const info = await inspectInstalledApp(p)
      const defaultIcon = info.icon || await readAppIcon(info.path)
      setPath(info.path)
      setIcon(defaultIcon || '')
      await hostToast('已恢复默认图标，保存后生效')
    } catch (error: any) {
      await hostToast(String(error?.message || error || '恢复默认图标失败'))
    } finally {
      setIconChanging(false)
    }
  }

  const changeCommandIcon = async (commandId: string, source: IconImageSource) => {
    if (!commands.some(command => command.id === commandId)) {
      await hostToast('命令不存在，未更改图标')
      return
    }

    setChangingCommandIconId(commandId)
    try {
      const dataUrl = await readIconImageDataUrl(source)
      if (!dataUrl) return
      setCommandsEdited(true)
      setCommands(prev => prev.map(command => command.id === commandId ? { ...command, icon: dataUrl } : command))
      await hostToast('命令图标已更新，保存后生效')
    } catch (error: any) {
      await hostToast(String(error?.message || error || '更改命令图标失败'))
    } finally {
      setChangingCommandIconId(null)
    }
  }

  const resetCommandIconToAppIcon = (commandId: string) => {
    setCommandsEdited(true)
    setCommands(prev => prev.map(command => {
      if (command.id !== commandId) return command
      const { icon: _icon, ...nextCommand } = command
      return nextCommand
    }))
  }

  const resolveIconForSave = async (appPath: string, inspectedIcon: string) => {
    return icon || inspectedIcon || await readAppIcon(appPath) || ''
  }

  const openRemoveConfirm = (app: RegisteredApp) => {
    closeEditMenu()
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
        const result = await stopRegisteredApp(app)
        await hostToast(appStopToastMessage(app.name, result))
      }
      await onRemove(app.id)
      await hostToast(`已取消注册：${app.name}`)
      if (editingId === app.id) {
        setHotkeyRecording(false)
        setRecordingCommandHotkeyId(null)
        setEditOpen(false)
        setEditingId(null)
      }
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
    if (!p) return

    setSaving(true)
    try {
      const info = await inspectInstalledApp(p)
      const nextName = n || info.name
      const existingApp = editingId ? apps.find(app => app.id === editingId) : null
      const nextIcon = await resolveIconForSave(info.path, info.icon)
      const nextHotkey = hotkey.trim()
      const nextHotkeyLaunchBehavior = nextHotkey ? hotkeyLaunchBehavior : undefined
      const nextCommands = normalizedCommands()
      const commandsToSave = commandsEdited ? nextCommands : []
      const nextApp: RegisteredApp = {
        id: info.id,
        name: nextName,
        icon: nextIcon,
        path: info.path,
        version: info.version,
        hotkey: nextHotkey || undefined,
        hotkeyLaunchBehavior: nextHotkeyLaunchBehavior,
        displayMode,
        commands: commandsToSave,
        autoStart,
        windowWidth: existingApp?.windowWidth,
        windowHeight: existingApp?.windowHeight,
        windowX: existingApp?.windowX,
        windowY: existingApp?.windowY,
      }

      if (editingId) {
        if (editingId === info.id) {
          await onUpdate(editingId, {
            name: nextApp.name,
            path: nextApp.path,
            version: nextApp.version,
            icon: nextIcon,
            hotkey: nextHotkey || null,
            hotkeyLaunchBehavior: nextHotkeyLaunchBehavior ?? null,
            displayMode,
            autoStart,
            commands: commandsToSave,
          })
        } else {
          await onReplace(editingId, nextApp)
        }
      } else {
        await onAdd(nextApp)
      }
      setHotkeyRecording(false)
      setRecordingCommandHotkeyId(null)
      closeEditMenu()
      setEditOpen(false)
    } catch (error: any) {
      await hostToast(String(error?.message || error || '保存应用失败'))
    } finally {
      setSaving(false)
    }
  }

  const startHotkeyRecording = () => {
    setRecordingCommandHotkeyId(null)
    setHotkeyRecording(true)
  }

  const saveHotkey = (next: string) => {
    setHotkey(next)
    setHotkeyRecording(false)
  }

  const cancelHotkeyRecording = () => {
    setHotkeyRecording(false)
  }

  const startCommandHotkeyRecording = (commandId: string) => {
    setHotkeyRecording(false)
    setRecordingCommandHotkeyId(commandId)
  }

  const saveCommandHotkey = (commandId: string, next: string) => {
    setCommandsEdited(true)
    setCommands(prev => prev.map(command => command.id === commandId ? { ...command, hotkey: next } : command))
    setRecordingCommandHotkeyId(null)
  }

  const clearCommandHotkey = (commandId: string) => {
    setCommandsEdited(true)
    setCommands(prev => prev.map(command => {
      if (command.id !== commandId) return command
      const { hotkey: _hotkey, ...nextCommand } = command
      return nextCommand
    }))
    if (recordingCommandHotkeyId === commandId) setRecordingCommandHotkeyId(null)
  }

  useEffect(() => {
    if (!hotkeyRecording && !recordingCommandHotkeyId) return

    pauseShortcutRecordingGuards()

    return () => {
      resumeShortcutRecordingGuards()
    }
  }, [hotkeyRecording, recordingCommandHotkeyId])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!hotkeyRecording && !recordingCommandHotkeyId) return
    e.preventDefault()
    e.stopPropagation()
    ;(e as any).stopImmediatePropagation?.()

    if (e.key === 'Escape') {
      setHotkeyRecording(false)
      setRecordingCommandHotkeyId(null)
      return
    }

    if (e.repeat) return
    const shot = buildShortcutFromEvent(e.nativeEvent)
    if (!shot) return
    if (recordingCommandHotkeyId) {
      saveCommandHotkey(recordingCommandHotkeyId, shot)
      return
    }
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
            <Button onClick={openAdd} variant="contained" size="small" sx={{ ...hostButtonSx, flexShrink: 0 }}>
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
            <AppCardView key={app.id} app={app} onClick={() => openEdit(app)} />
          ))
        )}
      </Box>

      <Dialog open={editOpen} onClose={closeEditDialog} fullWidth maxWidth="md">
        <DialogTitle sx={{ pr: editingId ? 6 : undefined }}>
          {editingId ? '编辑应用' : '添加应用'}
          {editingId ? (
            <>
              <IconButton
                aria-label="更多应用操作"
                size="small"
                onClick={e => setEditMenuAnchorEl(e.currentTarget)}
                sx={{ position: 'absolute', right: 8, top: 8 }}
              >
                <MoreVertRoundedIcon fontSize="small" />
              </IconButton>
              <Menu
                anchorEl={editMenuAnchorEl}
                open={!!editMenuAnchorEl}
                onClose={closeEditMenu}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                transformOrigin={{ vertical: 'top', horizontal: 'right' }}
              >
                <MenuItem
                  disabled={!editingApp || !!removingId}
                  onClick={() => editingApp && openRemoveConfirm(editingApp)}
                  sx={{ color: 'error.main', gap: 1 }}
                >
                  <DeleteRoundedIcon fontSize="small" />
                  取消注册
                </MenuItem>
              </Menu>
            </>
          ) : null}
        </DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }} onKeyDown={onKeyDown}>
          <TextField label="名称" value={name} onChange={e => setName(e.target.value)} size="small" fullWidth sx={hostTextFieldSx} />
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <TextField label="可执行文件路径" value={path} onChange={e => setPath(e.target.value)} size="small" fullWidth placeholder="C:\Apps\my-app\app.exe" sx={hostTextFieldSx} />
            <Button variant="text" onClick={() => void pickExecutablePath()} disabled={pickingPath || saving} sx={{ ...hostButtonSx, flexShrink: 0 }}>
              {pickingPath ? '选择中…' : '选择文件'}
            </Button>
          </Box>
          <AppIconEditor
            name={name}
            icon={icon}
            saving={saving}
            changing={iconChanging}
            canReset={!!path.trim()}
            onChange={source => void changeIcon(source)}
            onResetDefault={() => void resetIconToDefault()}
          />
          <TextField
            label="快捷键（可选）"
            value={hotkey}
            size="small"
            fullWidth
            placeholder="点击录制然后按键"
            InputProps={{ readOnly: true }}
            helperText={hotkeyRecording ? '录制中…按 ESC 取消，按下组合键即可保存到输入框里。' : '点击开始录制，然后按下组合键。'}
            sx={hostTextFieldSx}
          />
          <Stack direction="row" spacing={1}>
            <Button variant={hotkeyRecording ? 'contained' : 'text'} sx={hostButtonSx} color={hotkeyRecording ? 'warning' : 'primary'} onClick={hotkeyRecording ? cancelHotkeyRecording : startHotkeyRecording}>
              {hotkeyRecording ? '录制中…' : '开始录制'}
            </Button>
            <Button variant="text" sx={hostButtonSx} onClick={() => setHotkey('')}>
              清空快捷键
            </Button>
          </Stack>
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>快捷键启动方式</Typography>
            <ToggleButtonGroup
              value={hotkeyLaunchBehavior}
              exclusive
              onChange={(_, v) => v && setHotkeyLaunchBehavior(v)}
              size="small"
              disabled={!hotkey.trim()}
              aria-label="快捷键启动方式"
              sx={hostToggleGroupSx}
            >
              <ToggleButton value="launch">可启动未运行应用</ToggleButton>
              <ToggleButton value="runningOnly">仅控制已运行应用</ToggleButton>
            </ToggleButtonGroup>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.75, display: 'block' }}>
              选择“仅控制已运行应用”后，应用未运行时按下快捷键不会唤醒或启动它。
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>显示模式</Typography>
            <ToggleButtonGroup
              value={displayMode}
              exclusive
              onChange={(_, v) => v && setDisplayMode(v)}
              size="small"
              sx={hostToggleGroupSx}
            >
              <ToggleButton value="default">默认</ToggleButton>
              <ToggleButton value="window">窗口</ToggleButton>
              <ToggleButton value="top">置顶</ToggleButton>
            </ToggleButtonGroup>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>FW 启动时自启</Typography>
            <FormControlLabel
              sx={{ m: 0 }}
              control={
                <Switch
                  size="small"
                  checked={autoStart}
                  disabled={saving}
                  onChange={e => setAutoStart(e.target.checked)}
                  inputProps={{ 'aria-label': 'FW 启动时自启' }}
                />
              }
              label={autoStart ? '已开启' : '已关闭'}
            />
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.75, display: 'block' }}>
              开启后，Fast Window 启动时会自动启动这个应用；关闭后仍可手动启动或通过快捷键唤醒。
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Button
              variant="text"
              disabled={saving || currentCommandsLoading || !path.trim()}
              onClick={() => void refreshCurrentCommandsFromCurrentPath()}
              sx={hostButtonSx}
            >
              启动并读取当前命令
            </Button>
            {currentCommandsLoading ? <CircularProgress size={18} /> : null}
            <Typography variant="caption" color="text.secondary">
              {currentCommands.length ? `已读取 ${currentCommands.length} 个当前命令` : '当前没有可添加的命令'}
            </Typography>
          </Box>
          {currentCommandsError ? <Alert severity="warning" sx={{ borderRadius: 2 }}>{currentCommandsError}</Alert> : null}
          <AppCommandEditor
            commands={commands}
            currentCommands={currentCommands}
            appIcon={icon}
            appName={name}
            disabled={saving}
            changingCommandIconId={changingCommandIconId}
            recordingCommandId={recordingCommandHotkeyId}
            onChangeIcon={(commandId, source) => void changeCommandIcon(commandId, source)}
            onResetIcon={resetCommandIconToAppIcon}
            onStartHotkeyRecording={startCommandHotkeyRecording}
            onClearHotkey={clearCommandHotkey}
            onChange={nextCommands => {
              setCommandsEdited(true)
              setCommands(nextCommands)
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button disabled={saving} onClick={closeEditDialog}>取消</Button>
          <Button disabled={saving} onClick={() => void save()} variant="contained" sx={hostButtonSx}>保存</Button>
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
            sx={hostDangerButtonSx}
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
        <Button onClick={openAdd} variant="contained" size="small" sx={hostButtonSx}>
          添加应用
        </Button>
      </DialogActions>
    </Dialog>
  )
}
