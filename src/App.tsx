import { useState, useEffect, useCallback, ComponentType, useRef } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { loadAllPluginsReport, type PluginLoadRejection } from './plugins/pluginLoader'
import { initPluginApi } from './plugins/pluginApi'
import BackgroundPluginHost from './plugins/BackgroundPluginHost'
import { PluginCapability } from './plugins/pluginContract'
import {
  Alert,
  Avatar,
  Box,
  Button,
  CircularProgress,
  IconButton,
  InputAdornment,
  List,
  ListItemAvatar,
  ListItemButton,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Snackbar,
  TextField,
  Typography,
} from '@mui/material'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import CheckRoundedIcon from '@mui/icons-material/CheckRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import DragIndicatorRoundedIcon from '@mui/icons-material/DragIndicatorRounded'
import FileUploadRoundedIcon from '@mui/icons-material/FileUploadRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded'
import ViewListRoundedIcon from '@mui/icons-material/ViewListRounded'
import ViewModuleRoundedIcon from '@mui/icons-material/ViewModuleRounded'
import AppsRoundedIcon from '@mui/icons-material/AppsRounded'
import SettingsView from './components/SettingsView'
import ImportPluginDialog from './components/ImportPluginDialog'
import BrowserBarWindow from './components/BrowserBarWindow'

// 初始化插件 API
initPluginApi()

interface Plugin {
  id: string
  name: string
  description: string
  icon: string
  keyword?: string
  requires?: PluginCapability[]
  backgroundCode?: string
  backgroundAutoStart?: boolean
  component: ComponentType<{ onBack: () => void }>
}

const APP_TITLE = 'Fast Window'

const APP_STORAGE_ID = '__app'
const PLUGIN_ORDER_KEY = 'pluginOrder'
const PLUGIN_BROWSE_LAYOUT_KEY = 'pluginBrowseLayout'

type PluginBrowseLayout = 'list' | 'grid' | 'icon'

function normalizeBrowseLayout(value: unknown): PluginBrowseLayout {
  if (value === 'grid') return 'grid'
  if (value === 'icon') return 'icon'
  return 'list'
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

async function makeThumbnailPngDataUrl(file: File, maxPx: number): Promise<string> {
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

  return canvas.toDataURL('image/png')
}

function normalizeOrder(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const ids: string[] = []
  for (const item of value) {
    if (typeof item === 'string' && item.trim()) ids.push(item)
  }
  return ids
}

function applyPluginOrder(list: Plugin[], orderIds: string[]): Plugin[] {
  if (!orderIds.length) return list

  const byId = new Map(list.map(p => [p.id, p]))
  const result: Plugin[] = []
  for (const id of orderIds) {
    const hit = byId.get(id)
    if (hit) {
      result.push(hit)
      byId.delete(id)
    }
  }
  for (const p of list) {
    if (byId.has(p.id)) result.push(p)
  }
  return result
}

function movePluginById(list: Plugin[], draggedId: string, targetId: string, dropAfter: boolean): Plugin[] {
  if (!draggedId || !targetId || draggedId === targetId) return list
  const fromIndex = list.findIndex(p => p.id === draggedId)
  const toIndex = list.findIndex(p => p.id === targetId)
  if (fromIndex < 0 || toIndex < 0) return list

  const next = list.slice()
  const [item] = next.splice(fromIndex, 1)
  let insertIndex = toIndex + (dropAfter ? 1 : 0)
  if (fromIndex < insertIndex) insertIndex -= 1
  if (insertIndex < 0) insertIndex = 0
  if (insertIndex > next.length) insertIndex = next.length
  next.splice(insertIndex, 0, item)
  return next
}

function TitleBar(props: {
  title: string
  onBack?: () => void
  onImportPlugin?: () => void
  onSettings?: () => void
  onReloadPlugins?: () => void
  reloadDisabled?: boolean
  reorderMode?: boolean
  onStartReorder?: () => void
  onSaveReorder?: () => void
  onCancelReorder?: () => void
  browseLayout?: PluginBrowseLayout
  onToggleBrowseLayout?: () => void
}) {
  const {
    title,
    onBack,
    onImportPlugin,
    onSettings,
    onReloadPlugins,
    reloadDisabled,
    reorderMode,
    onStartReorder,
    onSaveReorder,
    onCancelReorder,
    browseLayout,
    onToggleBrowseLayout,
  } = props
  return (
    <Box
      data-tauri-drag-region="true"
      sx={{
        height: 40,
        display: 'flex',
        alignItems: 'center',
        position: 'relative',
        px: 0.5,
        bgcolor: 'background.paper',
        borderBottom: 1,
        borderColor: 'divider',
        WebkitAppRegion: 'drag',
      }}
    >
      {onBack ? (
        <Box
          data-tauri-drag-region="false"
          sx={{ position: 'absolute', left: 6, display: 'flex', alignItems: 'center', gap: 0.5, WebkitAppRegion: 'no-drag' }}
        >
          <IconButton aria-label="返回" size="small" onClick={onBack}>
            <ArrowBackRoundedIcon fontSize="small" />
          </IconButton>
        </Box>
      ) : null}

      {!onBack ? (
        <Box
          data-tauri-drag-region="false"
          sx={{ position: 'absolute', right: 6, display: 'flex', alignItems: 'center', gap: 0.5, WebkitAppRegion: 'no-drag' }}
        >
          {reorderMode ? (
            <>
              {onCancelReorder ? (
                <IconButton aria-label="取消排序" size="small" onClick={onCancelReorder}>
                  <CloseRoundedIcon fontSize="small" />
                </IconButton>
              ) : null}
              {onSaveReorder ? (
                <IconButton aria-label="保存排序" size="small" onClick={onSaveReorder}>
                  <CheckRoundedIcon fontSize="small" />
                </IconButton>
              ) : null}
            </>
          ) : (
            <>
              {onImportPlugin ? (
                <IconButton aria-label="导入插件" size="small" onClick={onImportPlugin}>
                  <FileUploadRoundedIcon fontSize="small" />
                </IconButton>
              ) : null}
              {onReloadPlugins ? (
                <IconButton aria-label="刷新插件" size="small" onClick={onReloadPlugins} disabled={reloadDisabled}>
                  <RefreshRoundedIcon fontSize="small" />
                </IconButton>
              ) : null}
              {onToggleBrowseLayout ? (
                <IconButton
                  aria-label={
                    browseLayout === 'list'
                      ? '切换为网格布局'
                      : browseLayout === 'grid'
                        ? '切换为图标布局'
                        : '切换为列表布局'
                  }
                  size="small"
                  onClick={onToggleBrowseLayout}
                >
                  {browseLayout === 'list' ? (
                    <ViewModuleRoundedIcon fontSize="small" />
                  ) : browseLayout === 'grid' ? (
                    <AppsRoundedIcon fontSize="small" />
                  ) : (
                    <ViewListRoundedIcon fontSize="small" />
                  )}
                </IconButton>
              ) : null}
              {onStartReorder ? (
                <IconButton aria-label="拖拽排序模式" size="small" onClick={onStartReorder}>
                  <DragIndicatorRoundedIcon fontSize="small" />
                </IconButton>
              ) : null}
              {onSettings ? (
                <IconButton aria-label="设置" size="small" onClick={onSettings}>
                  <SettingsRoundedIcon fontSize="small" />
                </IconButton>
              ) : null}
            </>
          )}
        </Box>
      ) : null}

      <Typography
        variant="body2"
        color="text.secondary"
        sx={{
          width: '100%',
          textAlign: 'center',
          fontWeight: 600,
          letterSpacing: 0.2,
          px: 4,
          userSelect: 'none',
          pointerEvents: 'none',
        }}
      >
        {title}
      </Typography>
    </Box>
  )
}

const settingsPlugin: Plugin = {
  id: '__settings',
  name: '设置',
  description: '配置开机自启与唤醒窗口快捷键',
  icon: '⚙️',
  keyword: 'settings',
  component: SettingsView,
}

function App() {
  if (WebviewWindow.getCurrent().label === 'browser_bar') {
    return <BrowserBarWindow />
  }

  const [query, setQuery] = useState('')
  const [plugins, setPlugins] = useState<Plugin[]>([])
  const [allPlugins, setAllPlugins] = useState<Plugin[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [activePlugin, setActivePlugin] = useState<Plugin | null>(null)
  const [loading, setLoading] = useState(true)
  const [pluginsDir, setPluginsDir] = useState<string>('')
  const [pluginRejected, setPluginRejected] = useState<PluginLoadRejection[]>([])
  const [importOpen, setImportOpen] = useState(false)
  const [reorderMode, setReorderMode] = useState(false)
  const [browseLayout, setBrowseLayout] = useState<PluginBrowseLayout>('list')
  const [pluginMenu, setPluginMenu] = useState<{ plugin: Plugin; mouseX: number; mouseY: number } | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [dragOverAfter, setDragOverAfter] = useState(false)
  const selectedIdRef = useRef<string | null>(null)
  const allPluginsRef = useRef<Plugin[]>([])
  const pendingActivatePluginIdRef = useRef<string | null>(null)
  const prevQueryRef = useRef<string>('')
  const dragMovedRef = useRef(false)
  const reorderBackupRef = useRef<Plugin[] | null>(null)
  const reorderQueryBackupRef = useRef<string>('')
  const [toast, setToast] = useState<{ open: boolean; message: string; key: number }>({
    open: false,
    message: '',
    key: 0,
  })

  const loadPlugins = useCallback(async (opts?: { showToast?: boolean }) => {
    setLoading(true)
    try {
      const dir = await invoke<string>('get_plugins_dir')
      setPluginsDir(dir)
      console.log('Plugins directory:', dir)

      const report = await loadAllPluginsReport()
      setPluginRejected(report.rejected)
      console.log('Loaded plugins:', report.plugins.length)
      if (report.rejected.length) {
        console.warn('[plugin] rejected:', report.rejected)
      }

      const iconOverrides = await invoke<Record<string, string>>('get_plugin_icon_overrides').catch(
        () => ({} as Record<string, string>),
      )

      const pluginList: Plugin[] = report.plugins.map(p => ({
        id: p.manifest.id,
        name: p.manifest.name,
        description: p.manifest.description,
        icon: iconOverrides[p.manifest.id] || p.manifest.icon || '📦',
        keyword: p.manifest.keyword,
        requires: p.manifest.requires,
        backgroundCode: p.backgroundCode,
        backgroundAutoStart: !!(p.manifest.background && p.manifest.background.autoStart !== false),
        component: p.component,
      }))

      const saved = await invoke<unknown | null>('storage_get', { pluginId: APP_STORAGE_ID, key: PLUGIN_ORDER_KEY }).catch(
        () => null,
      )
      const ordered = applyPluginOrder(pluginList, normalizeOrder(saved))

      setAllPlugins(ordered)
      setPlugins(ordered)
      setActiveIndex(0)
      if (opts?.showToast) {
        setToast(prev => ({ open: true, message: '插件已刷新', key: prev.key + 1 }))
      }
    } catch (error) {
      console.error('Failed to load plugins:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  const reloadPlugins = useCallback(() => loadPlugins({ showToast: true }), [loadPlugins])

  const openPluginMenu = useCallback((e: React.MouseEvent, plugin: Plugin) => {
    e.preventDefault()
    if (reorderMode) return
    setPluginMenu({ plugin, mouseX: e.clientX + 2, mouseY: e.clientY + 2 })
  }, [reorderMode])

  const closePluginMenu = useCallback(() => setPluginMenu(null), [])

  const changePluginIcon = useCallback(async () => {
    const plugin = pluginMenu?.plugin
    if (!plugin) return
    setPluginMenu(null)

    try {
      const file = await pickImageFile()
      if (!file) return
      if (file.size > 50 * 1024 * 1024) {
        setToast(prev => ({ open: true, message: '图片过大（> 50MB）', key: prev.key + 1 }))
        return
      }
      const dataUrl = await makeThumbnailPngDataUrl(file, 128)
      await invoke('set_plugin_icon_override', { pluginId: plugin.id, dataUrl })
      setToast(prev => ({ open: true, message: '图标已更新', key: prev.key + 1 }))
      void loadPlugins()
    } catch (e) {
      console.error('Failed to change plugin icon:', e)
      const msg =
        typeof e === 'string'
          ? e
          : typeof (e as any)?.message === 'string'
            ? (e as any).message
            : typeof (e as any)?.toString === 'function'
              ? String(e)
              : ''
      setToast(prev => ({ open: true, message: msg ? `更改图标失败：${msg}` : '更改图标失败', key: prev.key + 1 }))
    }
  }, [pluginMenu, loadPlugins])

  const resetPluginIcon = useCallback(async () => {
    const plugin = pluginMenu?.plugin
    if (!plugin) return
    setPluginMenu(null)

    try {
      await invoke('remove_plugin_icon_override', { pluginId: plugin.id })
      setToast(prev => ({ open: true, message: '已恢复默认图标', key: prev.key + 1 }))
      void loadPlugins()
    } catch (e) {
      console.error('Failed to reset plugin icon:', e)
      setToast(prev => ({ open: true, message: '恢复默认图标失败（详情见控制台）', key: prev.key + 1 }))
    }
  }, [pluginMenu, loadPlugins])

  const backgroundHosts = allPlugins
    .filter(p => p.backgroundAutoStart && p.backgroundCode)
    .map(p => (
      <BackgroundPluginHost
        key={`bg-${p.id}`}
        pluginId={p.id}
        pluginCode={p.backgroundCode || ''}
        requires={p.requires}
      />
    ))

  // 初次加载插件
  useEffect(() => {
    loadPlugins()
  }, [loadPlugins])

  useEffect(() => {
    allPluginsRef.current = allPlugins
    const pending = pendingActivatePluginIdRef.current
    if (!pending) return
    const found = allPlugins.find(p => p.id === pending)
    if (found) {
      pendingActivatePluginIdRef.current = null
      setActivePlugin(found)
    }
  }, [allPlugins])

  useEffect(() => {
    let unlisten: UnlistenFn | null = null

    const activateById = (pluginId: string) => {
      const id = String(pluginId || '').trim()
      if (!id) return
      const list = allPluginsRef.current
      const found = list.find(p => p.id === id) || null
      if (found) {
        setActivePlugin(found)
      } else {
        pendingActivatePluginIdRef.current = id
      }
    }

    void (async () => {
      unlisten = await listen<{ pluginId: string }>('fast-window:activate-plugin', event => {
        activateById((event as any)?.payload?.pluginId)
      })
    })()

    return () => {
      if (unlisten) unlisten()
    }
  }, [])

  // 加载宿主主页面浏览布局
  useEffect(() => {
    void invoke<unknown | null>('storage_get', { pluginId: APP_STORAGE_ID, key: PLUGIN_BROWSE_LAYOUT_KEY })
      .then(saved => setBrowseLayout(normalizeBrowseLayout(saved)))
      .catch(() => {})
  }, [])

  // 插件/主程序通用 toast
  useEffect(() => {
    const onToast = (event: Event) => {
      const custom = event as CustomEvent<{ message?: unknown }>
      const message = typeof custom.detail?.message === 'string' ? custom.detail.message : ''
      if (!message) return
      setToast(prev => ({ open: true, message, key: prev.key + 1 }))
    }
    window.addEventListener('fast-window:toast', onToast)
    return () => window.removeEventListener('fast-window:toast', onToast)
  }, [])

  // 过滤插件
  useEffect(() => {
    const q = query.trim()
    const isQueryChanged = prevQueryRef.current !== query
    prevQueryRef.current = query

    const nextPlugins =
      q === ''
        ? allPlugins
        : allPlugins.filter(
            p => p.name.toLowerCase().includes(q.toLowerCase()) || p.keyword?.toLowerCase() === q.toLowerCase(),
          )

    setPlugins(nextPlugins)

    if (isQueryChanged) {
      setActiveIndex(0)
      return
    }

    const selectedId = selectedIdRef.current
    if (!selectedId) {
      setActiveIndex(0)
      return
    }
    const nextIndex = nextPlugins.findIndex(p => p.id === selectedId)
    setActiveIndex(nextIndex >= 0 ? nextIndex : 0)
  }, [query, allPlugins])

  useEffect(() => {
    selectedIdRef.current = plugins[activeIndex]?.id ?? null
  }, [plugins, activeIndex])

  const persistPluginOrder = useCallback((orderedPlugins: Plugin[]) => {
    const ids = orderedPlugins.map(p => p.id)
    void invoke('storage_set', { pluginId: APP_STORAGE_ID, key: PLUGIN_ORDER_KEY, value: ids }).catch(e => {
      console.error('Failed to persist plugin order:', e)
    })
  }, [])

  const startReorder = useCallback(() => {
    reorderBackupRef.current = allPlugins
    reorderQueryBackupRef.current = query
    setQuery('')
    setReorderMode(true)
    setToast(prev => ({ open: true, message: '进入拖拽排序模式：拖动列表，点右上角保存', key: prev.key + 1 }))
  }, [allPlugins, query])

  const cancelReorder = useCallback(() => {
    const backup = reorderBackupRef.current
    if (backup) setAllPlugins(backup)
    setReorderMode(false)
    setDraggingId(null)
    setDragOverId(null)
    setDragOverAfter(false)
    setQuery(reorderQueryBackupRef.current)
    reorderBackupRef.current = null
    setToast(prev => ({ open: true, message: '已取消排序', key: prev.key + 1 }))
  }, [])

  const saveReorder = useCallback(() => {
    persistPluginOrder(allPlugins)
    setReorderMode(false)
    setDraggingId(null)
    setDragOverId(null)
    setDragOverAfter(false)
    setQuery(reorderQueryBackupRef.current)
    reorderBackupRef.current = null
    setToast(prev => ({ open: true, message: '排序已保存', key: prev.key + 1 }))
  }, [allPlugins, persistPluginOrder])

  const toggleBrowseLayout = useCallback(() => {
    setBrowseLayout(prev => {
      const next: PluginBrowseLayout = prev === 'list' ? 'grid' : prev === 'grid' ? 'icon' : 'list'
      void invoke('storage_set', { pluginId: APP_STORAGE_ID, key: PLUGIN_BROWSE_LAYOUT_KEY, value: next }).catch(() => {})
      return next
    })
  }, [])

  const handlePointerDown = useCallback((e: React.PointerEvent, pluginId: string) => {
    if (!reorderMode) return
    if (e.button !== 0) return

    dragMovedRef.current = false
    setDraggingId(pluginId)
    setDragOverId(pluginId)
    setDragOverAfter(false)

    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      // ignore
    }
    e.preventDefault()
  }, [reorderMode])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!reorderMode) return
    if (!draggingId) return

    dragMovedRef.current = true

    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
    const host = el?.closest?.('[data-plugin-id]') as HTMLElement | null
    const targetId = host?.dataset?.pluginId
    if (!targetId || targetId === draggingId) return

    setDragOverId(targetId)
    const rect = host.getBoundingClientRect()
    setDragOverAfter(e.clientY > rect.top + rect.height / 2)
  }, [draggingId, reorderMode])

  const handlePointerUp = useCallback(() => {
    if (!reorderMode) return
    if (!draggingId) return

    const targetId = dragOverId
    if (targetId && targetId !== draggingId) {
      const nextAll = movePluginById(allPlugins, draggingId, targetId, dragOverAfter)
      if (nextAll !== allPlugins) setAllPlugins(nextAll)
    }

    setDraggingId(null)
    setDragOverId(null)
    setDragOverAfter(false)
  }, [allPlugins, dragOverAfter, dragOverId, draggingId, reorderMode])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex(i => Math.min(i + 1, plugins.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && plugins[activeIndex]) {
      e.preventDefault()
      if (reorderMode) return
      setActivePlugin(plugins[activeIndex])
    } else if (e.key === 'Escape') {
      if (activePlugin) {
        setActivePlugin(null)
      } else {
        getCurrentWindow().hide()
      }
    }
  }, [plugins, activeIndex, activePlugin, reorderMode])

  const shellRootSx = {
    height: '100vh',
    outline: 'none',
  } as const

  const shellContainerSx = {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    borderRadius: '0 0 16px 16px',
    overflow: 'hidden',
    bgcolor: 'background.default',
  } as const

  const toastHost = (
    <Snackbar
      key={toast.key}
      open={toast.open}
      autoHideDuration={900}
      onClose={() => setToast(prev => ({ ...prev, open: false }))}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      sx={{ mb: 4 }}
    >
      <Alert
        variant="filled"
        severity="success"
        onClose={() => setToast(prev => ({ ...prev, open: false }))}
        sx={{ borderRadius: 999, py: 0.25, alignItems: 'center' }}
      >
        {toast.message}
      </Alert>
    </Snackbar>
  )

  const pluginContextMenu = (
    <Menu
      open={!!pluginMenu}
      onClose={closePluginMenu}
      anchorReference="anchorPosition"
      anchorPosition={pluginMenu ? { top: pluginMenu.mouseY, left: pluginMenu.mouseX } : { top: 0, left: 0 }}
    >
      <MenuItem
        onClick={() => {
          void changePluginIcon()
        }}
      >
        更改图标…
      </MenuItem>
      <MenuItem
        onClick={() => {
          void resetPluginIcon()
        }}
      >
        恢复默认图标
      </MenuItem>
    </Menu>
  )

  const importDialog = (
    <ImportPluginDialog
      open={importOpen}
      onClose={() => setImportOpen(false)}
      onInstalled={() => {
        setToast(prev => ({ open: true, message: '插件已导入', key: prev.key + 1 }))
        reloadPlugins()
      }}
    />
  )

  // 加载中
  if (loading) {
    return (
      <Box onKeyDown={handleKeyDown} tabIndex={0} sx={shellRootSx}>
        <Paper variant="outlined" sx={shellContainerSx}>
          <TitleBar title={APP_TITLE} />
          <Box sx={{ flex: 1, display: 'grid', placeItems: 'center' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
              <CircularProgress size={18} />
              <Typography variant="body2" color="text.secondary">
                加载插件中...
              </Typography>
            </Box>
          </Box>
        </Paper>
        {toastHost}
        {pluginContextMenu}
        {importDialog}
        {backgroundHosts}
      </Box>
    )
  }

  // 如果有激活的插件，渲染插件视图
  if (activePlugin) {
    const PluginComponent = activePlugin.component
    return (
      <Box onKeyDown={handleKeyDown} tabIndex={0} sx={shellRootSx}>
        <Paper variant="outlined" sx={shellContainerSx}>
          <TitleBar title={activePlugin.name} onBack={() => setActivePlugin(null)} />
          <Box sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
            <PluginComponent onBack={() => setActivePlugin(null)} />
          </Box>
        </Paper>
        {toastHost}
        {pluginContextMenu}
        {importDialog}
        {backgroundHosts}
      </Box>
    )
  }

  return (
    <Box onKeyDown={handleKeyDown} tabIndex={0} sx={shellRootSx}>
        <Paper variant="outlined" sx={shellContainerSx}>
          <TitleBar
            title={APP_TITLE}
            onImportPlugin={reorderMode ? undefined : () => setImportOpen(true)}
            onReloadPlugins={reorderMode ? undefined : reloadPlugins}
            reloadDisabled={loading}
            browseLayout={browseLayout}
            onToggleBrowseLayout={reorderMode ? undefined : toggleBrowseLayout}
            onStartReorder={reorderMode ? undefined : startReorder}
            reorderMode={reorderMode}
            onCancelReorder={reorderMode ? cancelReorder : undefined}
            onSaveReorder={reorderMode ? saveReorder : undefined}
            onSettings={reorderMode ? undefined : () => setActivePlugin(settingsPlugin)}
          />

        <Box sx={{ p: 2, bgcolor: 'background.paper', borderBottom: 1, borderColor: 'divider' }}>
          <TextField
            fullWidth
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="输入关键词搜索插件..."
            variant="outlined"
            disabled={reorderMode}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchRoundedIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
            inputProps={{ 'aria-label': '搜索插件', autoComplete: 'off' }}
          />
        </Box>

        <Box sx={{ flex: 1, overflow: 'auto', p: 1 }}>
          {plugins.length === 0 ? (
            <Box sx={{ py: 4, textAlign: 'center' }}>
              <Typography variant="body2" color="text.secondary">
                没有找到插件
              </Typography>
              {pluginsDir ? (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{
                    display: 'block',
                    mt: 1,
                    px: 2,
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  插件目录：{pluginsDir}
                </Typography>
              ) : null}
              <Box sx={{ mt: 1, display: 'flex', justifyContent: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => void invoke('open_plugins_dir').catch(() => {})}
                >
                  打开插件目录
                </Button>
                <Button size="small" variant="outlined" onClick={reloadPlugins} disabled={loading}>
                  重新扫描
                </Button>
              </Box>
              {pluginRejected.length ? (
                <Box sx={{ mt: 2, mx: 'auto', maxWidth: 720, textAlign: 'left', px: 2 }}>
                  <Alert severity="warning" variant="outlined">
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      发现 {pluginRejected.length} 个插件目录，但加载被拒绝
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                      常见原因：apiVersion 不匹配、ui.type 不是 iframe、requires 缺失/含未知能力、manifest.id 与目录名不一致。
                    </Typography>
                    <Box component="ul" sx={{ mt: 1, mb: 0, pl: 2 }}>
                      {pluginRejected.slice(0, 6).map(r => (
                        <li key={`${r.pluginId}:${r.reason}`}>
                          <Typography variant="caption">
                            {r.pluginId}：{r.reason}
                          </Typography>
                        </li>
                      ))}
                      {pluginRejected.length > 6 ? (
                        <li>
                          <Typography variant="caption" color="text.secondary">
                            …还有 {pluginRejected.length - 6} 个（详情见控制台日志）
                          </Typography>
                        </li>
                      ) : null}
                    </Box>
                  </Alert>
                </Box>
              ) : null}
            </Box>
          ) : (
            browseLayout === 'grid' ? (
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                  gap: 1,
                  p: 0.5,
                }}
              >
                {plugins.map((plugin, index) => (
                  <ListItemButton
                    key={plugin.id}
                    data-plugin-id={plugin.id}
                    selected={index === activeIndex}
                    onContextMenu={e => openPluginMenu(e, plugin)}
                    onPointerDown={reorderMode ? (e => handlePointerDown(e, plugin.id)) : undefined}
                    onPointerMove={reorderMode ? handlePointerMove : undefined}
                    onPointerUp={reorderMode ? handlePointerUp : undefined}
                    onPointerCancel={reorderMode ? handlePointerUp : undefined}
                    onClick={() => {
                      if (reorderMode) {
                        setActiveIndex(index)
                        return
                      }
                      if (dragMovedRef.current) {
                        dragMovedRef.current = false
                        return
                      }
                      setActiveIndex(index)
                      setActivePlugin(plugin)
                    }}
                    sx={{
                      borderRadius: 2,
                      alignItems: 'stretch',
                      flexDirection: 'column',
                      gap: 1,
                      py: 1.25,
                      px: 1.25,
                      border: 'none',
                      '&.Mui-selected': {
                        bgcolor: 'action.selected',
                      },
                      cursor: reorderMode ? (draggingId ? 'grabbing' : 'grab') : undefined,
                      opacity: draggingId === plugin.id ? 0.6 : 1,
                      userSelect: reorderMode ? 'none' : undefined,
                      touchAction: reorderMode ? 'none' : undefined,
                      boxShadow:
                        dragOverId === plugin.id
                          ? (theme =>
                              dragOverAfter
                                ? `inset 0 -2px 0 ${theme.palette.primary.main}`
                                : `inset 0 2px 0 ${theme.palette.primary.main}`)
                          : undefined,
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Avatar
                        variant="rounded"
                        src={isDataImageUrl(plugin.icon) ? plugin.icon : undefined}
                        imgProps={{ alt: plugin.name }}
                        sx={theme => ({
                          width: 36,
                          height: 36,
                          fontSize: 18,
                          bgcolor: theme.palette.action.hover,
                          color: theme.palette.text.primary,
                        })}
                      >
                        {isDataImageUrl(plugin.icon) ? null : plugin.icon}
                    </Avatar>
                      <Box sx={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
                        <Typography
                          variant="body2"
                          sx={{ fontWeight: 700, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis' }}
                          noWrap
                        >
                          {plugin.name}
                        </Typography>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}
                          noWrap
                        >
                          {plugin.description}
                        </Typography>
                      </Box>
                    </Box>
                  </ListItemButton>
                ))}
              </Box>
            ) : browseLayout === 'icon' ? (
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))',
                  gap: 1,
                  p: 0.5,
                }}
              >
                {plugins.map((plugin, index) => (
                  <ListItemButton
                    key={plugin.id}
                    data-plugin-id={plugin.id}
                    selected={index === activeIndex}
                    onContextMenu={e => openPluginMenu(e, plugin)}
                    onPointerDown={reorderMode ? (e => handlePointerDown(e, plugin.id)) : undefined}
                    onPointerMove={reorderMode ? handlePointerMove : undefined}
                    onPointerUp={reorderMode ? handlePointerUp : undefined}
                    onPointerCancel={reorderMode ? handlePointerUp : undefined}
                    onClick={() => {
                      if (reorderMode) {
                        setActiveIndex(index)
                        return
                      }
                      if (dragMovedRef.current) {
                        dragMovedRef.current = false
                        return
                      }
                      setActiveIndex(index)
                      setActivePlugin(plugin)
                    }}
                    sx={{
                      borderRadius: 2,
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      py: 1.25,
                      px: 1,
                      gap: 0.75,
                      '&.Mui-selected': { bgcolor: 'action.selected' },
                      cursor: reorderMode ? (draggingId ? 'grabbing' : 'grab') : undefined,
                      opacity: draggingId === plugin.id ? 0.6 : 1,
                      userSelect: reorderMode ? 'none' : undefined,
                      touchAction: reorderMode ? 'none' : undefined,
                      boxShadow:
                        dragOverId === plugin.id
                          ? (theme =>
                              dragOverAfter
                                ? `inset 0 -2px 0 ${theme.palette.primary.main}`
                                : `inset 0 2px 0 ${theme.palette.primary.main}`)
                          : undefined,
                    }}
                  >
                    <Avatar
                      src={isDataImageUrl(plugin.icon) ? plugin.icon : undefined}
                      imgProps={{ alt: plugin.name }}
                      sx={{
                        width: 56,
                        height: 56,
                        fontSize: 26,
                        bgcolor: 'action.hover',
                        color: 'text.primary',
                      }}
                    >
                      {isDataImageUrl(plugin.icon) ? null : plugin.icon}
                    </Avatar>
                    <Typography
                      variant="caption"
                      sx={{
                        fontWeight: 700,
                        lineHeight: 1.2,
                        textAlign: 'center',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                      }}
                    >
                      {plugin.name}
                    </Typography>
                  </ListItemButton>
                ))}
              </Box>
            ) : (
              <List disablePadding sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                {plugins.map((plugin, index) => (
                  <ListItemButton
                    key={plugin.id}
                    data-plugin-id={plugin.id}
                    selected={index === activeIndex}
                    onContextMenu={e => openPluginMenu(e, plugin)}
                    onPointerDown={reorderMode ? (e => handlePointerDown(e, plugin.id)) : undefined}
                    onPointerMove={reorderMode ? handlePointerMove : undefined}
                    onPointerUp={reorderMode ? handlePointerUp : undefined}
                    onPointerCancel={reorderMode ? handlePointerUp : undefined}
                    onClick={() => {
                      if (reorderMode) {
                        setActiveIndex(index)
                        return
                      }
                      if (dragMovedRef.current) {
                        dragMovedRef.current = false
                        return
                      }
                      setActivePlugin(plugin)
                    }}
                    sx={{
                      py: 1,
                      px: 1.25,
                      '&.Mui-selected': { bgcolor: 'action.selected' },
                      cursor: reorderMode ? (draggingId ? 'grabbing' : 'grab') : undefined,
                      opacity: draggingId === plugin.id ? 0.6 : 1,
                      userSelect: reorderMode ? 'none' : undefined,
                      touchAction: reorderMode ? 'none' : undefined,
                      boxShadow:
                        dragOverId === plugin.id
                          ? (theme =>
                              dragOverAfter
                                ? `inset 0 -2px 0 ${theme.palette.primary.main}`
                                : `inset 0 2px 0 ${theme.palette.primary.main}`)
                          : undefined,
                    }}
                  >
                    <ListItemAvatar sx={{ minWidth: 44 }}>
                      <Avatar
                        variant="rounded"
                        src={isDataImageUrl(plugin.icon) ? plugin.icon : undefined}
                        imgProps={{ alt: plugin.name }}
                        sx={theme => ({
                          width: 32,
                          height: 32,
                          fontSize: 18,
                          bgcolor: theme.palette.action.hover,
                          color: theme.palette.text.primary,
                        })}
                      >
                        {isDataImageUrl(plugin.icon) ? null : plugin.icon}
                      </Avatar>
                    </ListItemAvatar>
                    <ListItemText
                      primary={plugin.name}
                      secondary={plugin.description}
                      primaryTypographyProps={{ variant: 'body1', fontWeight: 600, noWrap: true }}
                      secondaryTypographyProps={{ variant: 'body2', color: 'text.secondary', noWrap: true }}
                    />
                  </ListItemButton>
                ))}
              </List>
            )
          )}
        </Box>

      </Paper>
      {toastHost}
      {pluginContextMenu}
      {importDialog}
      {backgroundHosts}
    </Box>
  )
}

export default App
