import { useEffect, useMemo, useState } from 'react'
import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { alpha } from '@mui/material/styles'
import {
  Avatar,
  Box,
  Button,
  CircularProgress,
  FormControlLabel,
  IconButton,
  Slider,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material'
import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded'
import FiberManualRecordRoundedIcon from '@mui/icons-material/FiberManualRecordRounded'
import StopRoundedIcon from '@mui/icons-material/StopRounded'
import BackspaceRoundedIcon from '@mui/icons-material/BackspaceRounded'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import {
  addWallpaperImage,
  DEFAULT_WALLPAPER_VIEW,
  getWallpaperSettings,
  removeWallpaperItem,
  setActiveWallpaper as setActiveWallpaperCmd,
  setWallpaperSettings,
  setWallpaperView,
  type WallpaperView,
  type WallpaperSettings,
} from '../wallpaper'
import WallpaperViewEditorDialog from './WallpaperViewEditorDialog'

const DEFAULT_WAKE_SHORTCUT = 'control+alt+Space'
const MAX_VIDEO_RATE = 16
const PROJECT_GITHUB_URL = 'https://github.com/noelle-silva/fast-window'
const APP_STORAGE_ID = '__app'
const DISABLED_PLUGINS_KEY = 'disabledPlugins'
const TAB_GENERAL = 0
const TAB_APPEARANCE = 1
const TAB_DATA = 2
const TAB_PLUGINS = 3
const TAB_SHORTCUT = 4
const TAB_WEBVIEW = 5
const TAB_ABOUT = 6

function toast(message: string) {
  window.dispatchEvent(new CustomEvent('fast-window:toast', { detail: { message } }))
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const list: string[] = []
  for (const item of value) {
    if (typeof item === 'string' && item.trim()) list.push(item)
  }
  return list
}

function isDataImageUrl(value: string): boolean {
  return value.startsWith('data:image/')
}

async function pickImageFile(): Promise<File | null> {
  return new Promise(resolve => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/png,image/jpeg,image/webp'
    input.onchange = () => {
      const file = input.files?.[0] ?? null
      resolve(file)
      input.remove()
    }
    input.oncancel = () => {
      resolve(null)
      input.remove()
    }
    input.style.position = 'fixed'
    input.style.left = '-9999px'
    document.body.appendChild(input)
    input.click()
  })
}

async function makeWallpaperDataUrl(file: File, maxPx: number): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.onload = () => resolve(String(reader.result || ''))
    reader.readAsDataURL(file)
  })

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error('加载图片失败'))
    el.src = dataUrl
  })

  const w = img.naturalWidth || img.width
  const h = img.naturalHeight || img.height
  if (!w || !h) throw new Error('图片尺寸无效')

  const scale = Math.min(1, maxPx / Math.max(w, h))
  const outW = Math.max(1, Math.round(w * scale))
  const outH = Math.max(1, Math.round(h * scale))

  const canvas = document.createElement('canvas')
  canvas.width = outW
  canvas.height = outH
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 不可用')
  ctx.drawImage(img, 0, 0, outW, outH)

  const webp = canvas.toDataURL('image/webp', 0.86)
  return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', 0.88)
}

function clampRate(raw: number) {
  if (!Number.isFinite(raw)) return 1
  return Math.min(MAX_VIDEO_RATE, Math.max(0.25, raw))
}

type AutoStartStatus = {
  supported: boolean
  enabled: boolean
  scope: string
}

type WebviewVideoSpeedPreset = {
  label: string
  rate: number
  shortcut?: string | null
}

type WebviewSettings = {
  video: {
    defaultRate: number
    maxRate: number
    presets: WebviewVideoSpeedPreset[]
  }
}

type PluginManageItem = {
  id: string
  name: string
  version: string
  description: string
  icon?: string
  allowOverwriteOnUpdate: boolean
}

const DEFAULT_WEBVIEW_SETTINGS: WebviewSettings = {
  video: {
    defaultRate: 1,
    maxRate: MAX_VIDEO_RATE,
    presets: [
      { label: '1x', rate: 1, shortcut: null },
      { label: '1.5x', rate: 1.5, shortcut: null },
      { label: '2x', rate: 2, shortcut: null },
    ],
  },
}

const modifierCodes = new Set([
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
])

function buildShortcutFromEvent(e: KeyboardEvent): string | null {
  const code = typeof e.code === 'string' ? e.code : ''
  if (!code || code === 'Unidentified') return null
  if (modifierCodes.has(code)) return null

  const parts: string[] = []
  if (e.ctrlKey) parts.push('control')
  if (e.altKey) parts.push('alt')
  if (e.shiftKey) parts.push('shift')
  if (e.metaKey) parts.push('super')
  parts.push(code)
  return parts.join('+')
}

export default function SettingsView(props: { onBack: () => void }) {
  const { onBack } = props
  const [dataDir, setDataDir] = useState<string>('')
  const [pluginsDir, setPluginsDir] = useState<string>('')
  const [current, setCurrent] = useState<string>('')
  const [input, setInput] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [recording, setRecording] = useState(false)
  const [webview, setWebview] = useState<WebviewSettings | null>(null)
  const [webviewSaving, setWebviewSaving] = useState(false)
  const [wallpaper, setWallpaper] = useState<WallpaperSettings | null>(null)
  const [wallpaperSaving, setWallpaperSaving] = useState(false)
  const [wallpaperViewOpen, setWallpaperViewOpen] = useState(false)
  const [targetAspect, setTargetAspect] = useState(() => {
    const w = window.innerWidth || 0
    const h = window.innerHeight || 0
    return w > 0 && h > 0 ? w / h : 16 / 9
  })
  const [recordingPresetIndex, setRecordingPresetIndex] = useState<number | null>(null)
  const [autoStart, setAutoStart] = useState<AutoStartStatus>({ supported: false, enabled: false, scope: 'unknown' })
  const [autoStartSaving, setAutoStartSaving] = useState(false)
  const [tabIndex, setTabIndex] = useState(TAB_GENERAL)
  const [pluginManageList, setPluginManageList] = useState<PluginManageItem[]>([])
  const [pluginManageDisabledIds, setPluginManageDisabledIds] = useState<string[]>([])
  const [pluginManageLoading, setPluginManageLoading] = useState(false)
  const [pluginManageSavingId, setPluginManageSavingId] = useState<string>('')

  const panelSx = (theme: any) => ({
    borderRadius: 2,
    p: 1.25,
    bgcolor: wallpaper?.enabled ? alpha(theme.palette.background.paper, 0.62) : theme.palette.background.paper,
    backdropFilter: wallpaper?.enabled ? 'blur(12px)' : undefined,
  })

  const wallpaperBaseUrl = useMemo(() => convertFileSrc('wallpaper', 'wallpaper'), [])
  const wallpaperView: WallpaperView = useMemo(() => {
    const v: any = wallpaper?.view || null
    const x = typeof v?.x === 'number' ? v.x : DEFAULT_WALLPAPER_VIEW.x
    const y = typeof v?.y === 'number' ? v.y : DEFAULT_WALLPAPER_VIEW.y
    const scale = typeof v?.scale === 'number' ? v.scale : DEFAULT_WALLPAPER_VIEW.scale
    return {
      x: Math.max(0, Math.min(100, x)),
      y: Math.max(0, Math.min(100, y)),
      scale: Math.max(1, Math.min(4, scale)),
    }
  }, [wallpaper?.view])

  useEffect(() => {
    const onResize = () => {
      const w = window.innerWidth || 0
      const h = window.innerHeight || 0
      if (w > 0 && h > 0) setTargetAspect(w / h)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    async function load() {
      const [dir, pdir, cur, st, wv, wp] = await Promise.all([
        invoke<string>('get_data_dir').catch(() => ''),
        invoke<string>('get_plugins_dir').catch(() => ''),
        invoke<string>('get_wake_shortcut').catch(() => ''),
        invoke<AutoStartStatus>('get_auto_start').catch(() => ({ supported: false, enabled: false, scope: 'unknown' })),
        invoke<WebviewSettings>('get_webview_settings').catch(() => null),
        getWallpaperSettings().catch(() => null),
      ])
      setDataDir(dir)
      setPluginsDir(pdir)
      setCurrent(cur)
      setInput(cur || DEFAULT_WAKE_SHORTCUT)
      setAutoStart(st)
      setWebview(wv || DEFAULT_WEBVIEW_SETTINGS)
      setWallpaper(
        wp || { enabled: false, opacity: 0.65, blur: 0, titlebarOpacity: 0.62, titlebarBlur: 12, filePath: null, items: [], activeId: null },
      )
    }
    load()
  }, [])

  async function applyWallpaperSettings(next: {
    enabled?: boolean
    opacity?: number
    blur?: number
    titlebarOpacity?: number
    titlebarBlur?: number
  }) {
    setWallpaperSaving(true)
    try {
      const prev = wallpaper || { enabled: false, opacity: 0.65, blur: 0, titlebarOpacity: 0.62, titlebarBlur: 12, filePath: null }
      const payload: any = {
        enabled: typeof next.enabled === 'boolean' ? next.enabled : prev.enabled,
        opacity: typeof next.opacity === 'number' ? next.opacity : prev.opacity,
        blur: typeof next.blur === 'number' ? next.blur : prev.blur,
      }
      if (typeof next.titlebarOpacity === 'number') payload.titlebarOpacity = next.titlebarOpacity
      if (typeof next.titlebarBlur === 'number') payload.titlebarBlur = next.titlebarBlur
      const normalized = await setWallpaperSettings(payload)
      setWallpaper(normalized)
      window.dispatchEvent(new CustomEvent('fast-window:wallpaper-changed'))
    } catch (e: any) {
      toast(String(e?.message || e || '设置失败'))
    } finally {
      setWallpaperSaving(false)
    }
  }

  async function saveWallpaperView(next: WallpaperView) {
    if (!wallpaper?.filePath) return
    setWallpaperSaving(true)
    try {
      const normalized = await setWallpaperView({ id: wallpaper.activeId || null, x: next.x, y: next.y, scale: next.scale })
      setWallpaper(normalized)
      window.dispatchEvent(new CustomEvent('fast-window:wallpaper-changed'))
      toast('已保存取景')
      setWallpaperViewOpen(false)
    } catch (e) {
      console.warn('[wallpaper] failed to save view:', e)
      toast('保存取景失败（详情见控制台）')
    } finally {
      setWallpaperSaving(false)
    }
  }

  async function chooseWallpaperImage() {
    setWallpaperSaving(true)
    try {
      const file = await pickImageFile()
      if (!file) return
      if (file.size > 80 * 1024 * 1024) {
        toast('图片过大（> 80MB）')
        return
      }
      const dataUrl = await makeWallpaperDataUrl(file, 2560)
      const normalized = await addWallpaperImage(dataUrl)
      setWallpaper(normalized)
      window.dispatchEvent(new CustomEvent('fast-window:wallpaper-changed'))
      toast('壁纸已添加')
    } catch (e: any) {
      toast(String(e?.message || e || '设置失败'))
    } finally {
      setWallpaperSaving(false)
    }
  }

  async function setActiveWallpaper(id: string) {
    const wid = String(id || '').trim()
    if (!wid) return
    setWallpaperSaving(true)
    try {
      const normalized = await setActiveWallpaperCmd(wid)
      setWallpaper(normalized)
      window.dispatchEvent(new CustomEvent('fast-window:wallpaper-changed'))
    } catch (e: any) {
      toast(String(e?.message || e || '切换失败'))
    } finally {
      setWallpaperSaving(false)
    }
  }

  async function deleteWallpaperItem(id: string) {
    const wid = String(id || '').trim()
    if (!wid) return
    setWallpaperSaving(true)
    try {
      const normalized = await removeWallpaperItem(wid)
      setWallpaper(normalized)
      window.dispatchEvent(new CustomEvent('fast-window:wallpaper-changed'))
      toast('已删除壁纸')
    } catch (e: any) {
      toast(String(e?.message || e || '删除失败'))
    } finally {
      setWallpaperSaving(false)
    }
  }

  async function loadPluginManage() {
    setPluginManageLoading(true)
    try {
      const [ids, disabledRaw, allowOverwriteIds] = await Promise.all([
        invoke<string[]>('list_plugins').catch(() => [] as string[]),
        invoke<unknown | null>('storage_get', { pluginId: APP_STORAGE_ID, key: DISABLED_PLUGINS_KEY }).catch(() => null),
        invoke<string[]>('get_plugins_allow_overwrite_on_update').catch(() => [] as string[]),
      ])
      const disabledIds = normalizeStringList(disabledRaw)
      const uniqueDisabledIds = Array.from(new Set(disabledIds))
      const allowOverwriteSet = new Set(allowOverwriteIds)

      const manifests = await Promise.all(ids.map(async (id): Promise<PluginManageItem | null> => {
        const pluginId = String(id || '').trim()
        if (!pluginId) return null
        try {
          const manifestText = await invoke<string>('read_plugin_file', { pluginId, path: 'manifest.json' })
          const m = JSON.parse(manifestText || '{}') as any
          const name = typeof m?.name === 'string' ? m.name.trim() : ''
          const version = typeof m?.version === 'string' ? m.version.trim() : ''
          const description = typeof m?.description === 'string' ? m.description : ''
          const icon = typeof m?.icon === 'string' ? m.icon.trim() : ''
          const allowOverwriteOnUpdate = allowOverwriteSet.has(pluginId)
          return {
            id: pluginId,
            name: name || pluginId,
            version: version || '-',
            description,
            icon: icon || undefined,
            allowOverwriteOnUpdate,
          }
        } catch (e) {
          console.warn('[plugin-manage] failed to read manifest:', pluginId, e)
          return { id: pluginId, name: pluginId, version: '-', description: '', icon: undefined, allowOverwriteOnUpdate: false }
        }
      }))

      const list = manifests.filter(Boolean) as PluginManageItem[]
      list.sort((a, b) => a.name.localeCompare(b.name))
      setPluginManageList(list)
      setPluginManageDisabledIds(uniqueDisabledIds)
    } finally {
      setPluginManageLoading(false)
    }
  }

  async function setPluginDisabled(pluginId: string, disabled: boolean) {
    const id = String(pluginId || '').trim()
    if (!id) return
    if (pluginManageSavingId) return
    setPluginManageSavingId(id)
    try {
      const current = new Set(pluginManageDisabledIds)
      if (disabled) current.add(id)
      else current.delete(id)
      const next = Array.from(current)
      await invoke('storage_set', { pluginId: APP_STORAGE_ID, key: DISABLED_PLUGINS_KEY, value: next })
      setPluginManageDisabledIds(next)
      window.dispatchEvent(new CustomEvent('fast-window:plugins-changed'))
      toast(disabled ? '插件已禁用' : '插件已启用')
    } catch (e: any) {
      toast(String(e?.message || e || '设置失败'))
      await loadPluginManage()
    } finally {
      setPluginManageSavingId('')
    }
  }

  async function setPluginAllowOverwriteOnUpdate(pluginId: string, enabled: boolean) {
    const id = String(pluginId || '').trim()
    if (!id) return
    if (pluginManageSavingId) return
    setPluginManageSavingId(id)
    try {
      await invoke('set_plugin_allow_overwrite_on_update', { pluginId: id, enabled })
      setPluginManageList(prev =>
        prev.map(p => (p.id === id ? { ...p, allowOverwriteOnUpdate: enabled } : p)),
      )
      toast(enabled ? '已允许覆盖更新' : '已关闭覆盖更新')
    } catch (e: any) {
      toast(String(e?.message || e || '设置失败'))
      await loadPluginManage()
    } finally {
      setPluginManageSavingId('')
    }
  }

  async function approveAllOverwriteUpdates() {
    if (pluginManageSavingId) return
    if (pluginManageLoading) return
    if (pluginManageList.length === 0) {
      toast('未发现任何插件')
      return
    }

    const pending = pluginManageList.filter(p => !p.allowOverwriteOnUpdate).map(p => p.id)
    if (pending.length === 0) {
      toast('已全部允许覆盖更新')
      return
    }

    setPluginManageSavingId('__bulk__')
    try {
      for (const pluginId of pending) {
        await invoke('set_plugin_allow_overwrite_on_update', { pluginId, enabled: true })
      }
      setPluginManageList(prev => prev.map(p => ({ ...p, allowOverwriteOnUpdate: true })))
      toast('已全部允许覆盖更新')
    } catch (e: any) {
      toast(String(e?.message || e || '设置失败'))
      await loadPluginManage()
    } finally {
      setPluginManageSavingId('')
    }
  }

  useEffect(() => {
    if (tabIndex !== TAB_PLUGINS) return
    loadPluginManage()
  }, [tabIndex])

  async function openDataDir() {
    try {
      await invoke('open_data_dir')
    } catch (e: any) {
      toast(String(e?.message || e || '打开目录失败'))
    }
  }

  async function openPluginsDir() {
    try {
      await invoke('open_plugins_dir')
    } catch (e: any) {
      toast(String(e?.message || e || '打开目录失败'))
    }
  }

  async function openProjectGithub() {
    try {
      await invoke('open_external_url', { url: PROJECT_GITHUB_URL })
    } catch (e: any) {
      toast(String(e?.message || e || '打开链接失败'))
    }
  }

  async function save(next: string) {
    const raw = next.trim()
    if (!raw) {
      toast('快捷键不能为空')
      return
    }

    setSaving(true)
    try {
      const normalized = await invoke<string>('set_wake_shortcut', { shortcut: raw })
      setCurrent(normalized)
      setInput(normalized)
      toast('已更新快捷键')
    } catch (e: any) {
      toast(String(e?.message || e || '设置失败'))
    } finally {
      setSaving(false)
    }
  }

  const recordHint = useMemo(() => {
    if (!recording) return '点击“开始录制”，然后按下你想要的组合键（ESC 取消）。'
    return '录制中…按下组合键（修饰键 + 主键），ESC 取消。'
  }, [recording])

  async function saveAutoStart(nextEnabled: boolean) {
    setAutoStartSaving(true)
    try {
      const st = await invoke<AutoStartStatus>('set_auto_start', { enabled: nextEnabled })
      setAutoStart(st)
      toast(nextEnabled ? '已开启开机自启' : '已关闭开机自启')
    } catch (e: any) {
      toast(String(e?.message || e || '设置失败'))
    } finally {
      setAutoStartSaving(false)
    }
  }

  useEffect(() => {
    if (!recording) return

    invoke('pause_wake_shortcut').catch(() => {})

    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      ;(e as any).stopImmediatePropagation?.()

      if (e.key === 'Escape') {
        setRecording(false)
        toast('已取消录制')
        return
      }

      if (e.repeat) return
      const shot = buildShortcutFromEvent(e)
      if (!shot) return

      setRecording(false)
      setInput(shot)
      save(shot)
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      invoke('resume_wake_shortcut').catch(() => {})
    }
  }, [recording])

  useEffect(() => {
    if (recordingPresetIndex == null) return

    invoke('pause_wake_shortcut').catch(() => {})

    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      ;(e as any).stopImmediatePropagation?.()

      if (e.key === 'Escape') {
        setRecordingPresetIndex(null)
        toast('已取消录制')
        return
      }

      if (e.repeat) return
      const shot = buildShortcutFromEvent(e)
      if (!shot) return

      setRecordingPresetIndex(null)
      setWebview(prev => {
        if (!prev) return prev
        const nextPresets = prev.video.presets.map((p, idx) => (idx === recordingPresetIndex ? { ...p, shortcut: shot } : p))
        return { ...prev, video: { ...prev.video, presets: nextPresets } }
      })
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      invoke('resume_wake_shortcut').catch(() => {})
    }
  }, [recordingPresetIndex])

  async function saveWebview(next: WebviewSettings) {
    setWebviewSaving(true)
    try {
      const normalized = await invoke<WebviewSettings>('set_webview_settings', { settings: next })
      setWebview(normalized)
      toast('已更新 WebView 设置')
    } catch (e: any) {
      toast(String(e?.message || e || '设置失败'))
    } finally {
      setWebviewSaving(false)
    }
  }

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Box
        data-tauri-drag-region="true"
        sx={theme => ({
          height: 44,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 0.75,
          bgcolor: wallpaper?.enabled ? alpha(theme.palette.background.paper, 0.62) : theme.palette.background.paper,
          backdropFilter: wallpaper?.enabled ? 'blur(12px)' : undefined,
          borderBottom: 1,
          borderColor: 'divider',
          WebkitAppRegion: 'drag',
        })}
      >
        <IconButton aria-label="返回" size="small" onClick={onBack} data-tauri-drag-region="false" sx={{ WebkitAppRegion: 'no-drag' }}>
          <ArrowBackRoundedIcon fontSize="small" />
        </IconButton>
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ flex: 1, textAlign: 'center', fontWeight: 700, userSelect: 'none', pointerEvents: 'none' }}
        >
          设置
        </Typography>
        <Box aria-hidden sx={{ width: 32, height: 32 }} />
      </Box>

      <Box sx={{ p: 2, flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', boxSizing: 'border-box' }}>
        <Box sx={theme => ({ ...panelSx(theme), p: 0.5, px: 0.75, pt: 0.25, pb: 0.25 })}>
          <Tabs
            value={tabIndex}
            onChange={(_, next) => {
              const nextIndex = typeof next === 'number' ? next : TAB_GENERAL
              if ((recording || recordingPresetIndex != null) && nextIndex !== tabIndex) {
                setRecording(false)
                setRecordingPresetIndex(null)
                toast('已取消录制')
              }
              setTabIndex(nextIndex)
            }}
            variant="scrollable"
            allowScrollButtonsMobile
            aria-label="设置分类"
            sx={{ minHeight: 40 }}
          >
            <Tab value={TAB_GENERAL} label="常规" id="settings-tab-0" aria-controls="settings-tabpanel-0" />
            <Tab value={TAB_APPEARANCE} label="外观" id="settings-tab-1" aria-controls="settings-tabpanel-1" />
            <Tab value={TAB_DATA} label="数据" id="settings-tab-2" aria-controls="settings-tabpanel-2" />
            <Tab value={TAB_PLUGINS} label="插件管理" id="settings-tab-3" aria-controls="settings-tabpanel-3" />
            <Tab value={TAB_SHORTCUT} label="快捷键" id="settings-tab-4" aria-controls="settings-tabpanel-4" />
            <Tab value={TAB_WEBVIEW} label="WebView" id="settings-tab-5" aria-controls="settings-tabpanel-5" />
            <Tab value={TAB_ABOUT} label="关于" id="settings-tab-6" aria-controls="settings-tabpanel-6" />
          </Tabs>
        </Box>

      <Box role="tabpanel" hidden={tabIndex !== TAB_GENERAL} id="settings-tabpanel-0" aria-labelledby="settings-tab-0" sx={{ pt: 0.5 }}>
        {tabIndex === TAB_GENERAL ? (
          <Stack spacing={1.25}>
            <Box sx={panelSx}>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                开机自启
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {autoStart.supported
                  ? `开启后会在 Windows 登录后自动运行（${autoStart.scope === 'currentUser' ? '当前用户' : autoStart.scope}）。配置写入 ${
                      dataDir ? `${dataDir}/app.json` : 'data/app.json'
                    } 的 autoStart`
                  : '当前平台不支持开机自启设置'}
              </Typography>
              <Box sx={{ mt: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>
                <FormControlLabel
                  sx={{ m: 0 }}
                  control={
                    <Switch
                      checked={autoStart.enabled}
                      disabled={!autoStart.supported || autoStartSaving || saving || recording}
                      onChange={e => saveAutoStart(e.target.checked)}
                      inputProps={{ 'aria-label': '开机自启' }}
                    />
                  }
                  label={autoStart.enabled ? '已开启' : '已关闭'}
                />
                <Typography variant="caption" color="text.secondary">
                  {autoStart.supported ? '仅影响本机当前用户' : '不可用'}
                </Typography>
              </Box>
            </Box>

          </Stack>
        ) : null}
      </Box>

      <Box role="tabpanel" hidden={tabIndex !== TAB_APPEARANCE} id="settings-tabpanel-1" aria-labelledby="settings-tab-1" sx={{ pt: 0.5 }}>
        {tabIndex === TAB_APPEARANCE ? (
          <Stack spacing={1.25}>
            <Box sx={theme => ({ ...panelSx(theme), display: 'grid', gap: 1 })}>
              <Box>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  壁纸背景（主窗口）
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  仅影响宿主主窗口；可调透明度与模糊，不影响插件自身渲染。
                </Typography>
              </Box>

              <Box
                sx={{
                  position: 'relative',
                  height: 120,
                  borderRadius: 2,
                  overflow: 'hidden',
                  bgcolor: 'action.hover',
                }}
              >
                {wallpaper?.filePath ? (
                  <>
                    <Box
                      component="img"
                      alt=""
                      draggable={false}
                      src={`${wallpaperBaseUrl}?rev=${wallpaper.rev ?? 0}`}
                      aria-hidden
                      sx={{
                        position: 'absolute',
                        inset: 0,
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        objectPosition: `${wallpaperView.x}% ${wallpaperView.y}%`,
                        transform: `scale(${(wallpaperView.scale || 1) * 1.05})`,
                        transformOrigin: `${wallpaperView.x}% ${wallpaperView.y}%`,
                        opacity: Math.max(0, Math.min(1, wallpaper.opacity || 0)),
                        filter: `blur(${Math.max(0, Math.min(40, wallpaper.blur || 0))}px)`,
                      }}
                    />
                    <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Typography
                        variant="caption"
                        sx={{ px: 1, py: 0.25, borderRadius: 999, bgcolor: 'rgba(0,0,0,0.35)', color: '#fff' }}
                      >
                        预览
                      </Typography>
                    </Box>
                  </>
                ) : (
                  <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Typography variant="caption" color="text.secondary">
                      未设置壁纸
                    </Typography>
                  </Box>
                )}
              </Box>

              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                <Button size="small" variant="outlined" onClick={chooseWallpaperImage} disabled={wallpaperSaving || saving || recording}>
                  添加壁纸
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => setWallpaperViewOpen(true)}
                  disabled={wallpaperSaving || saving || recording || !wallpaper?.filePath}
                >
                  调整取景
                </Button>
              </Box>

              {wallpaper?.filePath ? (
                <WallpaperViewEditorDialog
                  open={wallpaperViewOpen}
                  imageUrl={`${wallpaperBaseUrl}?rev=${wallpaper.rev ?? 0}`}
                  targetAspect={targetAspect}
                  initialView={wallpaperView}
                  onClose={() => setWallpaperViewOpen(false)}
                  onSave={v => void saveWallpaperView(v)}
                />
              ) : null}

              {Array.isArray(wallpaper?.items) && wallpaper.items.length ? (
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  {wallpaper.items.map(it => {
                    const active = !!wallpaper?.activeId && wallpaper.activeId === it.id
                    const thumbUrl = `${wallpaperBaseUrl}?id=${encodeURIComponent(it.id)}&rev=${it.rev ?? 0}`
                    return (
                      <Box
                        key={it.id}
                        role="button"
                        tabIndex={0}
                        aria-label={active ? '当前壁纸' : '切换壁纸'}
                        onClick={() => void setActiveWallpaper(it.id)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            void setActiveWallpaper(it.id)
                          }
                        }}
                        sx={{
                          width: 88,
                          height: 52,
                          borderRadius: 1.5,
                          overflow: 'hidden',
                          position: 'relative',
                          cursor: wallpaperSaving || saving || recording ? 'not-allowed' : 'pointer',
                          pointerEvents: wallpaperSaving || saving || recording ? 'none' : 'auto',
                          border: 1,
                          borderColor: active ? 'primary.main' : 'divider',
                          boxShadow: active ? 2 : 0,
                          bgcolor: 'action.hover',
                        }}
                      >
                        <Box
                          aria-hidden
                          sx={{
                            position: 'absolute',
                            inset: 0,
                            backgroundImage: `url(${thumbUrl})`,
                            backgroundSize: 'cover',
                            backgroundPosition: 'center',
                            transform: 'scale(1.02)',
                          }}
                        />
                        <Box sx={{ position: 'absolute', top: 2, right: 2 }}>
                          <IconButton
                            aria-label="删除壁纸"
                            size="small"
                            color="error"
                            onClick={e => {
                              e.stopPropagation()
                              void deleteWallpaperItem(it.id)
                            }}
                            sx={{
                              bgcolor: 'rgba(0,0,0,0.35)',
                              color: '#fff',
                              '&:hover': { bgcolor: 'rgba(0,0,0,0.55)' },
                            }}
                          >
                            <DeleteRoundedIcon fontSize="inherit" />
                          </IconButton>
                        </Box>
                      </Box>
                    )
                  })}
                </Box>
              ) : null}

              <FormControlLabel
                sx={{ m: 0 }}
                control={
                  <Switch
                    checked={!!wallpaper?.enabled}
                    disabled={wallpaperSaving || saving || recording || !wallpaper?.filePath}
                    onChange={e => void applyWallpaperSettings({ enabled: e.target.checked })}
                    inputProps={{ 'aria-label': '启用壁纸背景' }}
                  />
                }
                label={wallpaper?.enabled ? '已启用' : '未启用'}
              />

              <Box>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  透明度：{Math.round(((wallpaper?.opacity ?? 0.65) || 0) * 100)}%
                </Typography>
                <Slider
                  value={Math.round(((wallpaper?.opacity ?? 0.65) || 0) * 100)}
                  min={0}
                  max={100}
                  step={1}
                  disabled={wallpaperSaving || saving || recording || !wallpaper?.filePath}
                  onChange={(_, v) => {
                    const val = typeof v === 'number' ? v : v[0] ?? 0
                    setWallpaper(prev => (prev ? { ...prev, opacity: val / 100 } : prev))
                  }}
                  onChangeCommitted={(_, v) => {
                    const val = typeof v === 'number' ? v : v[0] ?? 0
                    void applyWallpaperSettings({ opacity: val / 100 })
                  }}
                  aria-label="壁纸透明度"
                />
              </Box>

              <Box>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  模糊：{Math.round((wallpaper?.blur ?? 0) || 0)}px
                </Typography>
                <Slider
                  value={Math.round((wallpaper?.blur ?? 0) || 0)}
                  min={0}
                  max={40}
                  step={1}
                  disabled={wallpaperSaving || saving || recording || !wallpaper?.filePath}
                  onChange={(_, v) => {
                    const val = typeof v === 'number' ? v : v[0] ?? 0
                    setWallpaper(prev => (prev ? { ...prev, blur: val } : prev))
                  }}
                  onChangeCommitted={(_, v) => {
                    const val = typeof v === 'number' ? v : v[0] ?? 0
                    void applyWallpaperSettings({ blur: val })
                  }}
                  aria-label="壁纸模糊程度"
                />
              </Box>

              <Box>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  顶部栏透明度（仅壁纸启用时生效）：{Math.round(((wallpaper?.titlebarOpacity ?? 0.62) || 0) * 100)}%
                </Typography>
                <Slider
                  value={Math.round(((wallpaper?.titlebarOpacity ?? 0.62) || 0) * 100)}
                  min={0}
                  max={100}
                  step={1}
                  disabled={wallpaperSaving || saving || recording || !wallpaper?.filePath}
                  onChange={(_, v) => {
                    const val = typeof v === 'number' ? v : v[0] ?? 0
                    setWallpaper(prev => (prev ? { ...prev, titlebarOpacity: val / 100 } : prev))
                  }}
                  onChangeCommitted={(_, v) => {
                    const val = typeof v === 'number' ? v : v[0] ?? 0
                    void applyWallpaperSettings({ titlebarOpacity: val / 100 })
                  }}
                  aria-label="顶部栏透明度"
                />
              </Box>

              <Box>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  顶部栏磨砂（仅壁纸启用时生效）：{Math.round((wallpaper?.titlebarBlur ?? 12) || 0)}px
                </Typography>
                <Slider
                  value={Math.round((wallpaper?.titlebarBlur ?? 12) || 0)}
                  min={0}
                  max={40}
                  step={1}
                  disabled={wallpaperSaving || saving || recording || !wallpaper?.filePath}
                  onChange={(_, v) => {
                    const val = typeof v === 'number' ? v : v[0] ?? 0
                    setWallpaper(prev => (prev ? { ...prev, titlebarBlur: val } : prev))
                  }}
                  onChangeCommitted={(_, v) => {
                    const val = typeof v === 'number' ? v : v[0] ?? 0
                    void applyWallpaperSettings({ titlebarBlur: val })
                  }}
                  aria-label="顶部栏磨砂程度"
                />
              </Box>
            </Box>
          </Stack>
        ) : null}
      </Box>

      <Box role="tabpanel" hidden={tabIndex !== TAB_DATA} id="settings-tabpanel-2" aria-labelledby="settings-tab-2" sx={{ pt: 0.5 }}>
        {tabIndex === TAB_DATA ? (
          <Stack spacing={1.25}>
            <Box sx={panelSx}>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                数据与插件位置
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                data: {dataDir || '-'}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                plugins: {pluginsDir || '-'}
              </Typography>
              <Box sx={{ mt: 1, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                <Button size="small" variant="outlined" onClick={openDataDir}>
                  打开数据目录
                </Button>
                <Button size="small" variant="outlined" onClick={openPluginsDir} disabled={!pluginsDir}>
                  打开插件目录
                </Button>
              </Box>
            </Box>
          </Stack>
        ) : null}
      </Box>

      <Box role="tabpanel" hidden={tabIndex !== TAB_PLUGINS} id="settings-tabpanel-3" aria-labelledby="settings-tab-3" sx={{ pt: 0.5 }}>
        {tabIndex === TAB_PLUGINS ? (
          <Stack spacing={1.25}>
            <Box sx={theme => ({ ...panelSx(theme), display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1 })}>
              <Box>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  插件管理
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  禁用后插件不会出现在主页，也不会启动后台（如有）。
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  覆盖更新：宿主升级后可用随包版本覆盖更新（仅对内置插件生效，默认关闭）。
                </Typography>
	              </Box>
	              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
	                <Button
	                  size="small"
	                  variant="contained"
	                  onClick={() => void approveAllOverwriteUpdates()}
	                  disabled={pluginManageLoading || !!pluginManageSavingId || pluginManageList.length === 0}
	                  aria-label="一键全部同意覆盖更新"
	                >
	                  全部同意覆盖更新
	                </Button>
	                <Button
	                  size="small"
	                  variant="outlined"
	                  onClick={loadPluginManage}
	                  disabled={pluginManageLoading || !!pluginManageSavingId}
	                >
	                  刷新
	                </Button>
	              </Box>
	            </Box>

            {pluginManageLoading ? (
              <Box sx={theme => ({ ...panelSx(theme), display: 'flex', alignItems: 'center', gap: 1 })}>
                <CircularProgress size={16} />
                <Typography variant="body2" color="text.secondary">
                  加载插件列表中…
                </Typography>
              </Box>
            ) : null}

            <Stack spacing={1}>
              {pluginManageList.map(p => {
                const disabled = pluginManageDisabledIds.includes(p.id)
                const busy = pluginManageSavingId === p.id
                const icon = typeof p.icon === 'string' ? p.icon : ''
                const canShowIcon = !!icon && !icon.startsWith('file:') && !icon.startsWith('svg:')

                return (
                  <Box
                    key={p.id}
                    sx={theme => ({
                      ...panelSx(theme),
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 1,
                    })}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, flex: 1 }}>
                      <Avatar
                        variant="rounded"
                        src={canShowIcon && isDataImageUrl(icon) ? icon : undefined}
                        sx={{ width: 32, height: 32, fontSize: 18, bgcolor: 'action.hover', color: 'text.primary' }}
                      >
                        {canShowIcon && !isDataImageUrl(icon) ? icon : '📦'}
                      </Avatar>
                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap>
                          {p.name}
                        </Typography>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ display: 'block', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' }}
                          noWrap
                        >
                          {p.id} · v{p.version}
                        </Typography>
                        {p.description ? (
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }} noWrap>
                            {p.description}
                          </Typography>
                        ) : null}
                      </Box>
                    </Box>

                    <Stack direction="column" spacing={0} sx={{ alignItems: 'flex-end' }}>
                      <FormControlLabel
                        sx={{ m: 0 }}
                        control={
                          <Switch
                            size="small"
                            checked={p.allowOverwriteOnUpdate}
                            disabled={busy || pluginManageLoading || !!pluginManageSavingId}
                            onChange={e => void setPluginAllowOverwriteOnUpdate(p.id, e.target.checked)}
                            inputProps={{ 'aria-label': `允许覆盖更新 ${p.name}` }}
                          />
                        }
                        label="覆盖更新"
                      />
                      <FormControlLabel
                        sx={{ m: 0 }}
                        control={
                          <Switch
                            size="small"
                            checked={!disabled}
                            disabled={busy || pluginManageLoading || !!pluginManageSavingId}
                            onChange={e => void setPluginDisabled(p.id, !e.target.checked)}
                            inputProps={{ 'aria-label': `启用插件 ${p.name}` }}
                          />
                        }
                        label={disabled ? '已禁用' : '已启用'}
                      />
                    </Stack>
                  </Box>
                )
              })}
              {!pluginManageLoading && pluginManageList.length === 0 ? (
                <Box sx={theme => ({ ...panelSx(theme), p: 1 })}>
                  <Typography variant="body2" color="text.secondary">
                    未发现任何插件
                  </Typography>
                </Box>
              ) : null}
            </Stack>
          </Stack>
        ) : null}
      </Box>

      <Box role="tabpanel" hidden={tabIndex !== TAB_SHORTCUT} id="settings-tabpanel-4" aria-labelledby="settings-tab-4" sx={{ pt: 0.5 }}>
        {tabIndex === TAB_SHORTCUT ? (
          <Stack spacing={1.25}>
            <Box sx={panelSx}>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                唤醒窗口快捷键
              </Typography>
              <Typography variant="caption" color="text.secondary">
                保存后立即生效，并写入 {dataDir ? `${dataDir}/app.json` : 'data/app.json'} 的 wakeShortcut
              </Typography>
            </Box>

            <Box sx={theme => ({ ...panelSx(theme), display: 'flex', justifyContent: 'space-between', gap: 1 })}>
              <Typography variant="caption" color="text.secondary">
                当前
              </Typography>
              <Typography variant="caption" sx={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}>
                {current || '-'}
              </Typography>
            </Box>

            <TextField
              label="新的组合"
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="Ctrl+Alt+Space / Shift+Alt+KeyQ"
              size="small"
              autoComplete="off"
              helperText="用 + 连接，修饰键在前，主键在最后（例如 Ctrl+Alt+Space）"
              inputProps={{ readOnly: true, 'aria-readonly': true }}
            />

            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
              <Button
                variant={recording ? 'contained' : 'outlined'}
                color={recording ? 'warning' : 'primary'}
                disabled={saving || recordingPresetIndex != null || webviewSaving}
                onClick={() => setRecording(v => !v)}
              >
                {recording ? '录制中…' : '开始录制'}
              </Button>
              <Button
                variant="outlined"
                disabled={saving || recordingPresetIndex != null || webviewSaving}
                onClick={() => save(DEFAULT_WAKE_SHORTCUT)}
              >
                恢复默认
              </Button>
              <Button
                variant="outlined"
                disabled={saving || recordingPresetIndex != null || webviewSaving}
                onClick={() => save('alt+Space')}
              >
                预设 Alt+Space（Windows）
              </Button>
              <Button
                variant="outlined"
                disabled={saving || recordingPresetIndex != null || webviewSaving}
                onClick={() => save('control+alt+KeyQ')}
              >
                预设 Ctrl+Alt+Q
              </Button>
              <Button
                variant="outlined"
                disabled={saving || recordingPresetIndex != null || webviewSaving}
                onClick={() => save('control+alt+KeyW')}
              >
                预设 Ctrl+Alt+W
              </Button>
            </Stack>

            <Box sx={theme => ({ ...panelSx(theme), p: 1 })}>
              <Typography variant="caption" color={recording ? 'warning.main' : 'text.secondary'}>
                {recordHint}
              </Typography>
            </Box>
          </Stack>
        ) : null}
      </Box>

      <Box role="tabpanel" hidden={tabIndex !== TAB_WEBVIEW} id="settings-tabpanel-5" aria-labelledby="settings-tab-5" sx={{ pt: 0.5 }}>
        {tabIndex === TAB_WEBVIEW ? (
          <Stack spacing={1.25}>
            <Box sx={panelSx}>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                WebView（浏览）
              </Typography>
              <Typography variant="caption" color="text.secondary">
                配置写入 {dataDir ? `${dataDir}/app.json` : 'data/app.json'} 的 webview.video（快捷键仅在浏览窗口内生效）
              </Typography>
            </Box>

            <Box sx={theme => ({ ...panelSx(theme), display: 'flex', flexDirection: 'column', gap: 1 })}>
              <Box>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  视频默认倍速
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  当前：{`${clampRate(webview?.video.defaultRate ?? 1)}x`}（范围 0.25 ~ {MAX_VIDEO_RATE}）
                </Typography>
                <Slider
                  aria-label="视频默认倍速"
                  value={clampRate(webview?.video.defaultRate ?? 1)}
                  min={0.25}
                  max={MAX_VIDEO_RATE}
                  step={0.25}
                  valueLabelDisplay="auto"
                  disabled={!webview || webviewSaving || saving || recording || recordingPresetIndex != null}
                  onChange={(_, next) => {
                    const v = Array.isArray(next) ? next[0] : next
                    setWebview(prev => (prev ? { ...prev, video: { ...prev.video, defaultRate: clampRate(Number(v)) } } : prev))
                  }}
                />
              </Box>

              <Typography variant="caption" color="text.secondary">
                倍速预设与快捷键映射（允许不带修饰键；在输入框/可编辑区域内不会抢按键）
              </Typography>

              <Stack spacing={1}>
                {(webview?.video.presets || []).map((p, idx) => {
                  const rowBusy = recordingPresetIndex === idx
                  return (
                    <Box
                      key={`${idx}-${p.label}-${p.rate}`}
                      sx={theme => ({
                        borderRadius: 2,
                        p: 1,
                        bgcolor: wallpaper?.enabled ? alpha(theme.palette.background.paper, 0.62) : undefined,
                        backdropFilter: wallpaper?.enabled ? 'blur(12px)' : undefined,
                        display: 'grid',
                        gridTemplateColumns: '1fr 120px 1fr auto auto auto',
                        gap: 1,
                        alignItems: 'center',
                      })}
                    >
                      <TextField
                        label="名称"
                        size="small"
                        value={p.label}
                        onChange={e => {
                          const label = e.target.value
                          setWebview(prev => {
                            if (!prev) return prev
                            const next = prev.video.presets.map((it, i) => (i === idx ? { ...it, label } : it))
                            return { ...prev, video: { ...prev.video, presets: next } }
                          })
                        }}
                        inputProps={{ 'aria-label': `倍速预设名称 ${idx + 1}` }}
                        disabled={!webview || webviewSaving || saving || recording || recordingPresetIndex != null}
                      />

                      <TextField
                        label="倍速"
                        type="number"
                        size="small"
                        value={p.rate}
                        onChange={e => {
                          const rate = Number.parseFloat(e.target.value)
                          if (!Number.isFinite(rate)) return
                          setWebview(prev => {
                            if (!prev) return prev
                            const next = prev.video.presets.map((it, i) => (i === idx ? { ...it, rate } : it))
                            return { ...prev, video: { ...prev.video, presets: next } }
                          })
                        }}
                        inputProps={{ min: 0.25, max: MAX_VIDEO_RATE, step: 0.25, 'aria-label': `倍速预设倍速 ${idx + 1}` }}
                        disabled={!webview || webviewSaving || saving || recording || recordingPresetIndex != null}
                      />

                      <TextField
                        label="快捷键（只读）"
                        size="small"
                        value={p.shortcut || ''}
                        placeholder="点击右侧录制"
                        inputProps={{ readOnly: true, 'aria-readonly': true }}
                        disabled={!webview || webviewSaving || saving || recording || recordingPresetIndex != null}
                      />

                      <Button
                        size="small"
                        variant={rowBusy ? 'contained' : 'outlined'}
                        color={rowBusy ? 'warning' : 'primary'}
                        disabled={!webview || webviewSaving || saving || recording || (recordingPresetIndex != null && !rowBusy)}
                        onClick={() => setRecordingPresetIndex(v => (v === idx ? null : idx))}
                        startIcon={rowBusy ? <StopRoundedIcon fontSize="small" /> : <FiberManualRecordRoundedIcon fontSize="small" />}
                      >
                        {rowBusy ? '录制中…' : '录制'}
                      </Button>

                      <IconButton
                        aria-label="清除快捷键"
                        size="small"
                        disabled={!webview || webviewSaving || saving || recording || recordingPresetIndex != null}
                        onClick={() => {
                          setWebview(prev => {
                            if (!prev) return prev
                            const next = prev.video.presets.map((it, i) => (i === idx ? { ...it, shortcut: null } : it))
                            return { ...prev, video: { ...prev.video, presets: next } }
                          })
                        }}
                      >
                        <BackspaceRoundedIcon fontSize="small" />
                      </IconButton>

                      <IconButton
                        aria-label="删除预设"
                        size="small"
                        disabled={!webview || webviewSaving || saving || recording || recordingPresetIndex != null}
                        onClick={() => {
                          setWebview(prev => {
                            if (!prev) return prev
                            const next = prev.video.presets.filter((_, i) => i !== idx)
                            return { ...prev, video: { ...prev.video, presets: next } }
                          })
                        }}
                      >
                        <DeleteRoundedIcon fontSize="small" />
                      </IconButton>
                    </Box>
                  )
                })}
              </Stack>

              <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
                <Button
                  size="small"
                  variant="outlined"
                  disabled={!webview || webviewSaving || saving || recording || recordingPresetIndex != null}
                  onClick={() => {
                    setWebview(prev => {
                      if (!prev) return prev
                      const next = prev.video.presets.concat([{ label: '新预设', rate: 2, shortcut: null }])
                      return { ...prev, video: { ...prev.video, presets: next } }
                    })
                  }}
                >
                  添加预设
                </Button>
                <Button
                  size="small"
                  variant="contained"
                  disabled={!webview || webviewSaving || saving || recording || recordingPresetIndex != null}
                  onClick={() => webview && saveWebview(webview)}
                >
                  保存 WebView 设置
                </Button>
              </Stack>

              <Typography variant="caption" color={recordingPresetIndex != null ? 'warning.main' : 'text.secondary'}>
                {recordingPresetIndex != null ? '录制中…按下组合键（ESC 取消）。' : '提示：快捷键会在浏览窗口里即时生效。'}
              </Typography>
            </Box>
          </Stack>
        ) : null}
      </Box>

      <Box role="tabpanel" hidden={tabIndex !== TAB_ABOUT} id="settings-tabpanel-6" aria-labelledby="settings-tab-6" sx={{ pt: 0.5 }}>
        {tabIndex === TAB_ABOUT ? (
          <Stack spacing={1.25}>
            <Box sx={panelSx}>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                关于
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Fast Window · 开源项目
              </Typography>
              <Box sx={{ mt: 1, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                <Button size="small" variant="outlined" onClick={openProjectGithub}>
                  打开 GitHub
                </Button>
              </Box>
            </Box>
          </Stack>
        ) : null}
      </Box>
      </Box>
    </Box>
  )
}
