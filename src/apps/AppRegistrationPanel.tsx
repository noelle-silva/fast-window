import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { Theme } from '@mui/material/styles'
import {
  Box, Typography, IconButton, Button, Chip,
  Dialog, DialogTitle, DialogContent, DialogActions,
  Menu, MenuItem,
} from '@mui/material'
import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded'
import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded'
import type { AppRegistrationEditRequest, RegisteredApp, RegisteredAppUpdatePatch } from './types'
import type { AppServiceInfo } from './appServiceInfo'
import AppCardView from './AppCardView'
import AppRegistrationEditor, { emptyAppRegistrationDraft, type AppRegistrationDraft } from './AppRegistrationEditor'
import { getAppStatus } from './appLauncher'
import { listAppHostShortcuts } from './appHostShortcuts'
import { appStopToastMessage, stopRegisteredApp } from './appStop'
import { inspectInstalledApp } from './installedAppInfo'
import { loadAppServiceInfo } from './appServiceInfo'
import { hostToast } from '../host/hostPrimitives'
import { buildShortcutFromEvent, pauseShortcutRecordingGuards, resumeShortcutRecordingGuards } from '../shortcuts'
import { readIconImageDataUrl, type IconImageSource } from '../iconImageInput'
import { hostButtonSx, hostDangerButtonSx, hostHiddenScrollbarSx, hostSoftChipSx, hostSurfaceSx } from '../components/hostUiStyles'
import { useHostAppearance } from '../components/hostAppearance'

interface AppRegistrationPanelProps {
  apps: RegisteredApp[]
  onAdd: (app: RegisteredApp) => void | Promise<void>
  onReplace: (previousId: string, app: RegisteredApp) => void | Promise<void>
  onRemove: (id: string) => void | Promise<void>
  onUpdate: (id: string, patch: RegisteredAppUpdatePatch) => void | Promise<void>
  editRequest?: AppRegistrationEditRequest | null
  onEditRequestHandled?: (requestId: number) => void
}

type RemoveConfirmStep = 'remove' | 'stop-running'

type RemoveConfirmState = {
  app: RegisteredApp
  step: RemoveConfirmStep
} | null

type HostShortcutReadConfirmState = {
  app: RegisteredApp
  message: string
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
  editRequest,
  onEditRequestHandled,
}: AppRegistrationPanelProps) {
  const hostAppearance = useHostAppearance()
  const [draft, setDraft] = useState<AppRegistrationDraft>(emptyAppRegistrationDraft)
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [pickingPath, setPickingPath] = useState(false)
  const [iconChanging, setIconChanging] = useState(false)
  const [hotkeyRecording, setHotkeyRecording] = useState(false)
  const [readingHostShortcuts, setReadingHostShortcuts] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [removeConfirm, setRemoveConfirm] = useState<RemoveConfirmState>(null)
  const [hostShortcutReadConfirm, setHostShortcutReadConfirm] = useState<HostShortcutReadConfirmState>(null)
  const [detailMenuAnchorEl, setDetailMenuAnchorEl] = useState<HTMLElement | null>(null)
  const [serviceInfo, setServiceInfo] = useState<AppServiceInfo | null>(null)
  const [serviceInfoLoading, setServiceInfoLoading] = useState(false)
  const [serviceInfoError, setServiceInfoError] = useState<string | null>(null)
  const handledEditRequestIdRef = useRef<number | null>(null)
  const serviceInfoRequestIdRef = useRef(0)

  const selectedApp = selectedAppId ? apps.find(app => app.id === selectedAppId) ?? null : null
  const editorActive = creating || !!selectedApp

  const updateDraft = (patch: Partial<AppRegistrationDraft>) => {
    setDraft(prev => ({ ...prev, ...patch }))
  }

  const clearServiceInfo = () => {
    serviceInfoRequestIdRef.current += 1
    setServiceInfo(null)
    setServiceInfoError(null)
    setServiceInfoLoading(false)
  }

  const refreshServiceInfo = async (exePath: string) => {
    const requestId = ++serviceInfoRequestIdRef.current
    setServiceInfo(null)
    setServiceInfoError(null)
    setServiceInfoLoading(true)
    try {
      const info = await loadAppServiceInfo(exePath)
      if (serviceInfoRequestIdRef.current !== requestId) return
      setServiceInfo(info)
      updateDraft({ appKind: info.appKind })
    } catch (error: any) {
      if (serviceInfoRequestIdRef.current !== requestId) return
      setServiceInfoError(String(error?.message || error || '读取服务信息失败'))
    } finally {
      if (serviceInfoRequestIdRef.current === requestId) setServiceInfoLoading(false)
    }
  }

  const closeDetailMenu = () => {
    setDetailMenuAnchorEl(null)
  }

  const selectApp = (app: RegisteredApp) => {
    setHotkeyRecording(false)
    setHostShortcutReadConfirm(null)
    setPickingPath(false)
    setIconChanging(false)
    setCreating(false)
    setSelectedAppId(app.id)
    setDraft({
      name: app.name,
      path: app.path,
      icon: app.icon || '',
      hotkey: app.hotkey ?? '',
      hotkeyLaunchBehavior: app.hotkeyLaunchBehavior ?? 'launch',
      displayMode: app.displayMode,
      autoStart: app.autoStart,
      hostShortcuts: Array.isArray(app.commands) ? app.commands : [],
      hostShortcutsEdited: false,
      hostShortcutCandidates: null,
      appKind: app.appKind ?? null,
    })
    closeDetailMenu()
    void refreshServiceInfo(app.path)
  }

  const openAdd = () => {
    setHotkeyRecording(false)
    setHostShortcutReadConfirm(null)
    setPickingPath(false)
    setIconChanging(false)
    setCreating(true)
    setSelectedAppId(null)
    setDraft(emptyAppRegistrationDraft())
    closeDetailMenu()
    clearServiceInfo()
  }

  useEffect(() => {
    if (!editRequest) return
    if (handledEditRequestIdRef.current === editRequest.requestId) return
    const app = apps.find(item => item.id === editRequest.appId)
    if (!app) return
    handledEditRequestIdRef.current = editRequest.requestId
    selectApp(app)
    onEditRequestHandled?.(editRequest.requestId)
  }, [apps, editRequest, onEditRequestHandled])

  const pickExecutablePath = async () => {
    setPickingPath(true)
    try {
      const picked = await invoke<string | null>('host_dialog_pick_app_executable')
      if (!picked) return
      const info = await inspectInstalledApp(picked)
      const nextIcon = info.icon || await readAppIcon(info.path)
      updateDraft({
        name: info.name,
        path: info.path,
        icon: nextIcon,
        displayMode: info.displayMode,
        hostShortcuts: info.commands,
        hostShortcutsEdited: true,
        appKind: info.appKind ?? null,
      })
      void refreshServiceInfo(info.path)
    } catch (error: any) {
      await hostToast(String(error?.message || error || '选择的文件不是有效 v5 应用'))
    } finally {
      setPickingPath(false)
    }
  }

  const normalizedHostShortcuts = () => draft.hostShortcuts
    .map(shortcut => ({
      ...shortcut,
      id: shortcut.id.trim(),
      title: shortcut.title.trim(),
      icon: shortcut.icon?.trim() || undefined,
      hotkey: shortcut.hotkey?.trim() || undefined,
    }))
    .filter(shortcut => shortcut.id && shortcut.title)

  const currentAppForHostShortcutRead = async (): Promise<RegisteredApp | null> => {
    const p = draft.path.trim()
    if (!p) {
      await hostToast('请先选择可执行文件')
      return null
    }

    const info = await inspectInstalledApp(p)
    const existingApp = selectedApp
    return {
      id: info.id,
      name: draft.name.trim() || info.name,
      icon: draft.icon || info.icon || await readAppIcon(info.path) || '',
      path: info.path,
      hotkey: draft.hotkey.trim() || undefined,
      hotkeyLaunchBehavior: draft.hotkey.trim() ? draft.hotkeyLaunchBehavior : undefined,
      displayMode: draft.displayMode,
      commands: normalizedHostShortcuts(),
      autoStart: draft.autoStart,
      windowWidth: existingApp?.windowWidth,
      windowHeight: existingApp?.windowHeight,
      windowX: existingApp?.windowX,
      windowY: existingApp?.windowY,
    }
  }

  const applyReadHostShortcuts = async (app: RegisteredApp, launchPolicy: 'runningOnly' | 'allowLaunch') => {
    setReadingHostShortcuts(true)
    try {
      const result = await listAppHostShortcuts([app], { launchPolicy })
      const hit = result.apps.find(item => item.appId === app.id)
      if (hit) {
        const hostShortcuts = Array.isArray(hit.hostShortcuts) ? hit.hostShortcuts : []
        updateDraft({ hostShortcutCandidates: hostShortcuts })
        await hostToast(hostShortcuts.length ? `已读取 ${hostShortcuts.length} 个宿主快捷命令，可在搜索框中挑选` : '这个 App 当前没有返回宿主快捷命令')
        return
      }

      const error = result.errors.find(item => item.appId === app.id)
      if (error?.canLaunch && launchPolicy === 'runningOnly') {
        setHostShortcutReadConfirm({ app, message: error.message || 'App 未运行，是否启动后读取宿主快捷命令？' })
        return
      }
      await hostToast(error?.message || '读取宿主快捷命令失败')
    } catch (error: any) {
      await hostToast(String(error?.message || error || '读取宿主快捷命令失败'))
    } finally {
      setReadingHostShortcuts(false)
    }
  }

  const readHostShortcuts = async () => {
    const app = await currentAppForHostShortcutRead()
    if (!app) return
    await applyReadHostShortcuts(app, 'runningOnly')
  }

  const confirmLaunchAndReadHostShortcuts = async () => {
    const app = hostShortcutReadConfirm?.app
    if (!app) return
    setHostShortcutReadConfirm(null)
    await applyReadHostShortcuts(app, 'allowLaunch')
  }

  const changeIcon = async (source: IconImageSource) => {
    setIconChanging(true)
    try {
      const dataUrl = await readIconImageDataUrl(source)
      if (!dataUrl) return
      updateDraft({ icon: dataUrl })
      await hostToast('图标已更新，保存后生效')
    } catch (error: any) {
      await hostToast(String(error?.message || error || '更改图标失败'))
    } finally {
      setIconChanging(false)
    }
  }

  const resetIconToDefault = async () => {
    const p = draft.path.trim()
    if (!p) {
      await hostToast('请先选择可执行文件')
      return
    }

    setIconChanging(true)
    try {
      const info = await inspectInstalledApp(p)
      const defaultIcon = info.icon || await readAppIcon(info.path)
      updateDraft({ path: info.path, icon: defaultIcon || '' })
      await hostToast('已恢复默认图标，保存后生效')
    } catch (error: any) {
      await hostToast(String(error?.message || error || '恢复默认图标失败'))
    } finally {
      setIconChanging(false)
    }
  }

  const startHotkeyRecording = () => {
    setHotkeyRecording(true)
  }

  const cancelHotkeyRecording = () => {
    setHotkeyRecording(false)
  }

  useEffect(() => {
    if (!hotkeyRecording) return

    pauseShortcutRecordingGuards()

    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      ;(e as any).stopImmediatePropagation?.()

      if (e.key === 'Escape') {
        setHotkeyRecording(false)
        return
      }

      if (e.repeat) return
      const shot = buildShortcutFromEvent(e)
      if (!shot) return
      updateDraft({ hotkey: shot })
      setHotkeyRecording(false)
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      resumeShortcutRecordingGuards()
    }
  }, [hotkeyRecording])

  const openRemoveConfirm = (app: RegisteredApp) => {
    closeDetailMenu()
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
      if (selectedAppId === app.id) {
        setHotkeyRecording(false)
        setSelectedAppId(null)
        setCreating(false)
        setDraft(emptyAppRegistrationDraft())
        closeDetailMenu()
        clearServiceInfo()
      }
      setRemoveConfirm(null)
    } catch (error: any) {
      await hostToast(String(error?.message || error || '取消注册失败'))
    } finally {
      setRemovingId(null)
    }
  }

  const save = async () => {
    const n = draft.name.trim()
    const p = draft.path.trim()
    if (!p) return

    setSaving(true)
    try {
      const info = await inspectInstalledApp(p)
      const nextName = n || info.name
      const existingApp = selectedApp
      const nextIcon = draft.icon || info.icon || await readAppIcon(info.path) || ''
      const nextHotkey = draft.hotkey.trim()
      const nextHotkeyLaunchBehavior = nextHotkey ? draft.hotkeyLaunchBehavior : undefined
      const nextHostShortcuts = normalizedHostShortcuts()
      const hostShortcutsToSave = draft.hostShortcutsEdited ? nextHostShortcuts : (existingApp?.commands ?? info.commands)
      const nextApp: RegisteredApp = {
        id: info.id,
        name: nextName,
        icon: nextIcon,
        path: info.path,
        hotkey: nextHotkey || undefined,
        hotkeyLaunchBehavior: nextHotkeyLaunchBehavior,
        displayMode: draft.displayMode,
        commands: hostShortcutsToSave,
        autoStart: draft.autoStart,
        windowWidth: existingApp?.windowWidth,
        windowHeight: existingApp?.windowHeight,
        windowX: existingApp?.windowX,
        windowY: existingApp?.windowY,
      }

      if (selectedAppId) {
        if (selectedAppId === info.id) {
          await onUpdate(selectedAppId, {
            name: nextApp.name,
            path: nextApp.path,
            icon: nextIcon,
            hotkey: nextHotkey || null,
            hotkeyLaunchBehavior: nextHotkeyLaunchBehavior ?? null,
            displayMode: draft.displayMode,
            autoStart: draft.autoStart,
            commands: hostShortcutsToSave,
          })
        } else {
          await onReplace(selectedAppId, nextApp)
        }
      } else {
        await onAdd(nextApp)
      }
      setHotkeyRecording(false)
      setCreating(false)
      setSelectedAppId(nextApp.id)
      closeDetailMenu()
      void refreshServiceInfo(nextApp.path)
    } catch (error: any) {
      await hostToast(String(error?.message || error || '保存应用失败'))
    } finally {
      setSaving(false)
    }
  }

  const listPanelSx = (theme: Theme) => ({
    ...hostSurfaceSx(hostAppearance.surfaceMode, { tone: 'item' })(theme),
    width: { xs: 168, sm: 208, md: 248 },
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    p: 1,
  })

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, justifyContent: 'space-between', alignItems: { xs: 'stretch', sm: 'flex-start' }, gap: 1, mb: 1.25 }}>
        <Box>
          <Typography variant="body2" sx={{ fontWeight: 700 }}>
            应用注册
          </Typography>
          <Typography variant="caption" color="text.secondary">
            管理可由 Fast Window 启动和唤醒的 v5 独立应用。
          </Typography>
        </Box>
        <Button
          onClick={openAdd}
          variant="text"
          size="small"
          sx={{ ...hostButtonSx, flexShrink: 0, alignSelf: 'flex-start' }}
          disabled={saving}
        >
          添加应用
        </Button>
      </Box>

      <Box sx={{ display: 'flex', gap: 1.25, flex: 1, minHeight: 0, minWidth: 0 }}>
        <Box sx={listPanelSx}>
          <Typography variant="caption" color="text.secondary" sx={{ px: 0.5, mb: 0.75, display: 'block' }}>
            应用列表
          </Typography>
          <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', ...hostHiddenScrollbarSx }}>
            {apps.length === 0 ? (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 0.5, py: 1 }}>
                暂无注册应用
              </Typography>
            ) : (
              apps.map(app => (
                <AppCardView
                  key={app.id}
                  app={app}
                  selected={!creating && app.id === selectedAppId}
                  onClick={() => selectApp(app)}
                />
              ))
            )}
          </Box>
        </Box>

        <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {editorActive ? (
            <>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  {creating ? '添加应用' : '编辑应用'}
                </Typography>
                {draft.appKind ? (
                  <Chip
                    label={draft.appKind === 'service-app' ? '服务' : '窗口'}
                    size="small"
                    sx={{ ...hostSoftChipSx, height: 20, fontSize: 11 }}
                  />
                ) : null}
                <Box sx={{ flex: 1 }} />
                <Button
                  onClick={() => void save()}
                  variant="contained"
                  size="small"
                  sx={hostButtonSx}
                  disabled={saving}
                >
                  {saving ? '保存中…' : '保存'}
                </Button>
                {selectedApp ? (
                  <>
                    <IconButton
                      aria-label="更多应用操作"
                      size="small"
                      onClick={e => setDetailMenuAnchorEl(e.currentTarget)}
                    >
                      <MoreVertRoundedIcon fontSize="small" />
                    </IconButton>
                    <Menu
                      anchorEl={detailMenuAnchorEl}
                      open={!!detailMenuAnchorEl}
                      onClose={closeDetailMenu}
                      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                    >
                      <MenuItem
                        disabled={!!removingId}
                        onClick={() => openRemoveConfirm(selectedApp)}
                        sx={{ color: 'error.main', gap: 1 }}
                      >
                        <DeleteRoundedIcon fontSize="small" />
                        取消注册
                      </MenuItem>
                    </Menu>
                  </>
                ) : null}
              </Box>
              <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', pr: 0.5, pb: 1, ...hostHiddenScrollbarSx }}>
                <AppRegistrationEditor
                  draft={draft}
                  saving={saving}
                  pickingPath={pickingPath}
                  iconChanging={iconChanging}
                  hotkeyRecording={hotkeyRecording}
                  readingHostShortcuts={readingHostShortcuts}
                  serviceInfo={serviceInfo}
                  serviceInfoLoading={serviceInfoLoading}
                  serviceInfoError={serviceInfoError}
                  onDraftChange={updateDraft}
                  onPickPath={() => void pickExecutablePath()}
                  onIconChange={source => void changeIcon(source)}
                  onIconReset={() => void resetIconToDefault()}
                  onStartHotkeyRecording={startHotkeyRecording}
                  onCancelHotkeyRecording={cancelHotkeyRecording}
                  onReadHostShortcuts={() => void readHostShortcuts()}
                  onServiceInfoSaved={() => void refreshServiceInfo(draft.path.trim())}
                />
              </Box>
            </>
          ) : (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, minHeight: 0 }}>
              <Typography variant="body2" color="text.secondary">
                从左侧选择一个应用，或添加新应用。
              </Typography>
            </Box>
          )}
        </Box>
      </Box>

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

      <Dialog open={!!hostShortcutReadConfirm} onClose={() => !readingHostShortcuts && setHostShortcutReadConfirm(null)} fullWidth maxWidth="xs">
        <DialogTitle>启动并读取宿主快捷命令</DialogTitle>
        <DialogContent sx={{ pt: '8px !important' }}>
          <Typography variant="body2" color="text.secondary">
            {hostShortcutReadConfirm?.message || 'App 未运行，是否启动后读取宿主快捷命令？'}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button disabled={readingHostShortcuts} onClick={() => setHostShortcutReadConfirm(null)}>取消</Button>
          <Button disabled={readingHostShortcuts} variant="contained" onClick={() => void confirmLaunchAndReadHostShortcuts()} sx={hostButtonSx}>
            启动并读取
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
