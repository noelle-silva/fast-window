import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { usePluginBackendStatuses, usePluginBackendSupervisor, resolveBackendLifecycle } from './plugins/backendSupervisor'
import { alpha } from '@mui/material/styles'
import {
  Alert, Box, Button, CircularProgress, Snackbar, TextField,
  Dialog, DialogActions, DialogContent, DialogTitle,
  InputAdornment, Typography,
} from '@mui/material'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import StorefrontRoundedIcon from '@mui/icons-material/StorefrontRounded'
import SettingsView from './components/SettingsView'
import PluginStoreView from './components/PluginStoreView'
import ImportPluginDialog from './components/ImportPluginDialog'
import BrowserBarWindow from './components/BrowserBarWindow'
import TitleBar from './TitleBar'
import PluginListView from './PluginListView'
import PluginDetailDialog from './PluginDetailDialog'
import PluginContextMenu, { type ContextMenuAction } from './PluginContextMenu'
import AppActivationView from './apps/AppActivationView'
import AppDetailDialog from './apps/AppDetailDialog'
import { useRegisteredApps } from './apps/useRegisteredApps'
import { getAppStatuses, launchApp } from './apps/appLauncher'
import {
  appStopConfirmLabel,
  appStopDialogDescription,
  appStopDialogTitle,
  appStopMenuLabel,
  appStopToastMessage,
  stopRegisteredApp,
  type AppStopConfirmState,
} from './apps/appStop'
import {
  buildRegisteredAppListItems,
  parseRegisteredAppListItemId,
  registeredAppFromListItem,
} from './apps/listItems'
import type { AppRegistrationEditRequest, AppStatus, RegisteredApp } from './apps/types'
import { usePlugins } from './usePlugins'
import { useWallpaper, getWallpaperView } from './useWallpaper'
import { useSearch } from './useSearch'
import type { Plugin } from './constants'
import { APP_TITLE } from './constants'
import { makeThumbnailPngDataUrl, movePluginById, pickImageFile } from './utils'

const settingsPlugin: Plugin = {
  id: '__settings',
  name: '设置',
  description: '配置开机自启与唤醒窗口快捷键',
  icon: '⚙️',
  keyword: 'settings',
  disabled: false,
  component: SettingsView,
}

const storePlugin: Plugin = {
  id: '__store',
  name: '应用商店',
  description: '从 GitHub 安装与更新插件',
  icon: '🛒',
  keyword: 'store',
  disabled: false,
  component: PluginStoreView,
}

function App() {
  if (WebviewWindow.getCurrent().label === 'browser_bar') {
    return <BrowserBarWindow />
  }

  // Toast
  const [toast, setToast] = useState<{ open: boolean; message: string; key: number }>({
    open: false, message: '', key: 0,
  })
  const showToast = useCallback((message: string) => {
    setToast(prev => ({ open: true, message, key: prev.key + 1 }))
  }, [])

  // Plugins
  const pluginCtx = usePlugins(showToast)
  const {
    plugins, allPlugins, setAllPlugins, pluginsDir,
    pluginRejected, browseLayout, loading, refreshingId,
    allPluginsRef, autoUpdateStartedRef,
    loadPlugins, reloadPlugins, refreshPlugin,
    persistPluginOrder, toggleBrowseLayout,
    changePluginIcon, resetPluginIcon,
    autoUpdatePlugins, loadBrowseLayout,
  } = pluginCtx

  // Registered Apps (v5)
  const registeredAppsCtx = useRegisteredApps()
  const { apps: registeredApps, load: loadRegisteredApps, add: addRegisteredApp, remove: removeRegisteredApp, update: updateRegisteredApp } = registeredAppsCtx
  const [registeredAppStatuses, setRegisteredAppStatuses] = useState<Record<string, AppStatus>>({})

  // Search
  const search = useSearch(plugins)
  const { query, setQuery, filtered, activeIndex, setActiveIndex } = search

  // Active plugin
  const [activePlugin, setActivePlugin] = useState<Plugin | null>(null)

  // Wallpaper
  const wallpaperCtx = useWallpaper()
  const { wallpaper, switching: wallpaperSwitching, cycle: cycleWallpaper } = wallpaperCtx

  // Keep-alive UI plugins
  const [keepAliveUiPluginIds, setKeepAliveUiPluginIds] = useState<string[]>([])

  // Import dialog
  const [importOpen, setImportOpen] = useState(false)

  // Reorder
  const [reorderMode, setReorderMode] = useState(false)
  const reorderBackupRef = useRef<Plugin[] | null>(null)
  const reorderQueryBackupRef = useRef<string>('')

  // Context menu
  const [pluginMenu, setPluginMenu] = useState<{ plugin: Plugin; mouseX: number; mouseY: number } | null>(null)
  const closePluginMenu = useCallback(() => setPluginMenu(null), [])
  const [stopAppConfirm, setStopAppConfirm] = useState<AppStopConfirmState>(null)
  const [stoppingAppId, setStoppingAppId] = useState<string | null>(null)

  // Detail dialog
  const [pluginDetail, setPluginDetail] = useState<Plugin | null>(null)
  const [appDetailId, setAppDetailId] = useState<string | null>(null)
  const [appRegistrationEditRequest, setAppRegistrationEditRequest] = useState<AppRegistrationEditRequest | null>(null)

  // Drag
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [dragOverAfter, setDragOverAfter] = useState(false)
  const dragMovedRef = useRef(false)
  const pendingActivatePluginIdRef = useRef<string | null>(null)

  // Backend
  const { backgroundHosts, controller: backendController } = usePluginBackendSupervisor({
    plugins: allPlugins,
    activePluginId: activePlugin?.id ?? null,
  })
  const backendStatusById = usePluginBackendStatuses(allPlugins)

  // === Effects ===

  useEffect(() => {
    loadPlugins()
    loadRegisteredApps()
    loadBrowseLayout()
    wallpaperCtx.load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (autoUpdateStartedRef.current) return
    if (loading) return
    autoUpdateStartedRef.current = true
    void autoUpdatePlugins()
  }, [loading, autoUpdatePlugins, autoUpdateStartedRef])

  // Wallpaper change listener
  useEffect(() => {
    const onChanged = () => { wallpaperCtx.load() }
    window.addEventListener('fast-window:wallpaper-changed', onChanged as any)
    return () => window.removeEventListener('fast-window:wallpaper-changed', onChanged as any)
  }, [wallpaperCtx])

  // Plugins changed listener
  useEffect(() => {
    const onChanged = () => { void loadPlugins() }
    window.addEventListener('fast-window:plugins-changed', onChanged as any)
    return () => window.removeEventListener('fast-window:plugins-changed', onChanged as any)
  }, [loadPlugins])

  useEffect(() => {
    let unlisten: UnlistenFn | null = null
    const reloadRegisteredApps = () => { void loadRegisteredApps() }

    window.addEventListener('fast-window:registered-apps-changed', reloadRegisteredApps)
    void (async () => {
      unlisten = await listen('fast-window:registered-apps-changed', reloadRegisteredApps)
    })().catch(() => {})

    return () => {
      window.removeEventListener('fast-window:registered-apps-changed', reloadRegisteredApps)
      if (unlisten) unlisten()
    }
  }, [loadRegisteredApps])

  const refreshRegisteredAppStatuses = useCallback(async () => {
    if (!registeredApps.length) {
      setRegisteredAppStatuses({})
      return
    }
    try {
      const result = await getAppStatuses(registeredApps.map(app => app.id))
      setRegisteredAppStatuses(result)
    } catch (error) {
      console.warn('[app] main list status refresh failed:', error)
    }
  }, [registeredApps])

  useEffect(() => {
    void refreshRegisteredAppStatuses()
    if (!registeredApps.length) return
    const timer = window.setInterval(() => {
      void refreshRegisteredAppStatuses()
    }, 5_000)
    return () => window.clearInterval(timer)
  }, [registeredApps.length, refreshRegisteredAppStatuses])

  // Disabled plugin check
  useEffect(() => {
    if (!activePlugin) return
    const hit = allPlugins.find(p => p.id === activePlugin.id)
    if (!hit || !hit.disabled) return
    setActivePlugin(null)
    showToast(`插件已禁用：${hit.name}`)
  }, [activePlugin, allPlugins, showToast])

  // Keep-alive management
  useEffect(() => {
    if (!activePlugin) return
    if (activePlugin.disabled) return
    if (activePlugin.manifest?.ui?.keepAlive !== true) return
    setKeepAliveUiPluginIds(prev => (prev.includes(activePlugin.id) ? prev : prev.concat(activePlugin.id)))
  }, [activePlugin])

  useEffect(() => {
    if (!keepAliveUiPluginIds.length) return
    const alive = new Set(allPlugins.filter(p => !p.disabled && p.manifest?.ui?.keepAlive === true).map(p => p.id))
    setKeepAliveUiPluginIds(prev => {
      const next = prev.filter(id => alive.has(id))
      return next.length === prev.length ? prev : next
    })
  }, [allPlugins, keepAliveUiPluginIds.length])

  // Pending activation
  useEffect(() => {
    allPluginsRef.current = allPlugins
    const pending = pendingActivatePluginIdRef.current
    if (!pending) return
    const found = allPlugins.find(p => p.id === pending)
    if (found) {
      pendingActivatePluginIdRef.current = null
      setActivePlugin(found)
    }
  }, [allPlugins, allPluginsRef])

  // Activate plugin (from Tauri event / DOM event)
  useEffect(() => {
    let unlisten: UnlistenFn | null = null

    const activateById = (pluginId: string) => {
      const id = String(pluginId || '').trim()
      if (!id) return
      const list = allPluginsRef.current
      const found = list.find(p => p.id === id) || null
      if (found) {
        if (found.disabled) {
          showToast(`插件已禁用：${found.name}`)
          return
        }
        setActivePlugin(found)
      } else {
        pendingActivatePluginIdRef.current = id
      }
    }

    const onDomActivate = (event: Event) => {
      const custom = event as CustomEvent<{ pluginId?: unknown }>
      activateById(String(custom.detail?.pluginId ?? ''))
    }

    window.addEventListener('fast-window:activate-plugin', onDomActivate as any)

    void (async () => {
      unlisten = await listen<{ pluginId: string }>('fast-window:activate-plugin', event => {
        activateById((event as any)?.payload?.pluginId)
      })
    })()

    return () => {
      try { window.removeEventListener('fast-window:activate-plugin', onDomActivate as any) } catch {}
      if (unlisten) unlisten()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Toast from DOM event
  useEffect(() => {
    const onToast = (event: Event) => {
      const custom = event as CustomEvent<{ message?: unknown }>
      const message = typeof custom.detail?.message === 'string' ? custom.detail.message : ''
      if (!message) return
      showToast(message)
    }
    window.addEventListener('fast-window:toast', onToast)
    return () => window.removeEventListener('fast-window:toast', onToast)
  }, [showToast])

  // Toast from Tauri event
  useEffect(() => {
    let unlisten: UnlistenFn | null = null
    void (async () => {
      unlisten = await listen<{ message?: unknown }>('fast-window:toast', event => {
        const message = typeof (event as any)?.payload?.message === 'string' ? String((event as any).payload.message) : ''
        if (!message) return
        showToast(message)
      })
    })().catch(() => {})
    return () => { if (unlisten) unlisten() }
  }, [showToast])

  // === Handlers ===

  const registeredAppPlugins: Plugin[] = useMemo(() => {
    return buildRegisteredAppListItems(registeredApps, registeredAppStatuses)
  }, [registeredApps, registeredAppStatuses])

  const displayItems: Plugin[] = useMemo(() => {
    const all = [...registeredAppPlugins, ...filtered]
    const q = query.trim().toLowerCase()
    if (!q) return all
    return all.filter(p => {
      const keyword = p.keyword?.toLowerCase() || ''
      return p.name.toLowerCase().includes(q) || keyword.includes(q)
    })
  }, [registeredAppPlugins, filtered, query])

  const activateListItem = useCallback((plugin: Plugin) => {
    const selection = parseRegisteredAppListItemId(plugin.id)
    if (selection.type === 'appCommand') {
      const app = registeredApps.find(app => app.id === selection.appId)
      if (app) {
        launchApp(app, 'show', selection.commandId).finally(() => window.setTimeout(() => void refreshRegisteredAppStatuses(), 500))
      }
      return
    }
    if (selection.type === 'app') {
      const app = registeredApps.find(app => app.id === selection.appId)
      if (app) {
        launchApp(app, 'show').finally(() => window.setTimeout(() => void refreshRegisteredAppStatuses(), 500))
      }
      return
    }
    setActivePlugin(plugin)
  }, [registeredApps, refreshRegisteredAppStatuses])

  const registeredAppFromMenuItem = useCallback((plugin: Plugin): RegisteredApp | null => {
    return registeredAppFromListItem(registeredApps, plugin.id)
  }, [registeredApps])

  const appDetail = useMemo(() => {
    if (!appDetailId) return null
    return registeredApps.find(app => app.id === appDetailId) ?? null
  }, [appDetailId, registeredApps])

  const requestAppRegistrationEdit = useCallback((app: RegisteredApp) => {
    setPluginDetail(null)
    setAppDetailId(null)
    setActivePlugin(settingsPlugin)
    setAppRegistrationEditRequest(prev => ({ appId: app.id, requestId: (prev?.requestId ?? 0) + 1 }))
  }, [])

  const handleAppRegistrationEditRequestHandled = useCallback((requestId: number) => {
    setAppRegistrationEditRequest(prev => (prev?.requestId === requestId ? null : prev))
  }, [])

  const changeMenuItemIcon = useCallback(async () => {
    const plugin = pluginMenu?.plugin
    if (!plugin) return
    const app = registeredAppFromMenuItem(plugin)
    if (!app) {
      await changePluginIcon(plugin)
      return
    }

    try {
      const file = await pickImageFile()
      if (!file) return
      if (file.size > 50 * 1024 * 1024) {
        showToast('图片过大（> 50MB）')
        return
      }
      const dataUrl = await makeThumbnailPngDataUrl(file, 128)
      await updateRegisteredApp(app.id, { icon: dataUrl })
      showToast('图标已更新')
    } catch (error: any) {
      console.error('Failed to change registered app icon:', error)
      const msg = typeof error === 'string' ? error : typeof error?.message === 'string' ? error.message : ''
      showToast(msg ? `更改图标失败：${msg}` : '更改图标失败')
    }
  }, [changePluginIcon, pluginMenu?.plugin, registeredAppFromMenuItem, showToast, updateRegisteredApp])

  const resetMenuItemIcon = useCallback(async () => {
    const plugin = pluginMenu?.plugin
    if (!plugin) return
    const app = registeredAppFromMenuItem(plugin)
    if (!app) {
      await resetPluginIcon(plugin)
      return
    }

    try {
      const icon = await invoke<string>('app_icon_data_url', { exePath: app.path }).catch(() => '')
      await updateRegisteredApp(app.id, { icon })
      showToast('已恢复默认图标')
    } catch (error: any) {
      console.error('Failed to reset registered app icon:', error)
      showToast('恢复默认图标失败（详情见控制台）')
    }
  }, [pluginMenu?.plugin, registeredAppFromMenuItem, resetPluginIcon, showToast, updateRegisteredApp])

  const closeStopAppConfirm = useCallback(() => {
    if (stoppingAppId) return
    setStopAppConfirm(null)
  }, [stoppingAppId])

  const confirmStopApp = useCallback(async () => {
    const app = stopAppConfirm?.app
    if (!app) return
    setStoppingAppId(app.id)
    try {
      const result = await stopRegisteredApp(app, stopAppConfirm.mode)
      showToast(appStopToastMessage(app.name, result, stopAppConfirm.mode))
      setStopAppConfirm(null)
      window.setTimeout(() => void refreshRegisteredAppStatuses(), 300)
    } catch (error: any) {
      showToast(String(error?.message || error || '停止应用失败'))
    } finally {
      setStoppingAppId(null)
    }
  }, [refreshRegisteredAppStatuses, showToast, stopAppConfirm?.app, stopAppConfirm?.mode])

  const pluginMenuActions = useMemo<ContextMenuAction[]>(() => {
    const plugin = pluginMenu?.plugin
    if (!plugin) return []
    const app = registeredAppFromMenuItem(plugin)
    const detailAction: ContextMenuAction = app
      ? { id: 'detail', label: '详情', onSelect: () => setAppDetailId(app.id) }
      : { id: 'detail', label: '详情', onSelect: () => setPluginDetail(plugin) }
    const commonActions: ContextMenuAction[] = [
      detailAction,
      { id: 'change-icon', label: '更改图标…', onSelect: () => void changeMenuItemIcon() },
      { id: 'reset-icon', label: '恢复默认图标', onSelect: () => void resetMenuItemIcon() },
    ]

    if (app) {
      return [
        { id: 'stop-app', label: appStopMenuLabel('graceful'), color: 'error', onSelect: () => setStopAppConfirm({ app, mode: 'graceful' }) },
        { id: 'force-stop-app', label: appStopMenuLabel('force'), color: 'error', onSelect: () => setStopAppConfirm({ app, mode: 'force' }) },
        { id: 'registration-edit', label: '注册编辑', onSelect: () => requestAppRegistrationEdit(app) },
        ...commonActions,
      ]
    }

    return [
      {
        id: 'refresh-plugin',
        label: '刷新',
        disabled: loading || refreshingId === plugin.id,
        onSelect: () => refreshPlugin(plugin),
      },
      ...commonActions,
    ]
  }, [changeMenuItemIcon, loading, pluginMenu?.plugin, refreshingId, refreshPlugin, registeredAppFromMenuItem, requestAppRegistrationEdit, resetMenuItemIcon])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex(i => Math.min(i + 1, displayItems.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && displayItems[activeIndex]) {
      e.preventDefault()
      if (reorderMode) return
      activateListItem(displayItems[activeIndex])
    } else if (e.key === 'Escape') {
      if (activePlugin) {
        setActivePlugin(null)
      } else {
        getCurrentWindow().hide()
      }
    }
  }, [displayItems, activeIndex, activePlugin, reorderMode, setActiveIndex, activateListItem])

  const handlePluginSelect = useCallback((plugin: Plugin, index: number) => {
    if (reorderMode) {
      setActiveIndex(index)
      return
    }
    if (dragMovedRef.current) {
      dragMovedRef.current = false
      return
    }
    setActiveIndex(index)
    activateListItem(plugin)
  }, [reorderMode, setActiveIndex, activateListItem])

  const handleContextMenu = useCallback((e: React.MouseEvent, plugin: Plugin) => {
    e.preventDefault()
    if (reorderMode) return
    setPluginMenu({ plugin, mouseX: e.clientX + 2, mouseY: e.clientY + 2 })
  }, [reorderMode])

  // Reorder
  const startReorder = useCallback(() => {
    reorderBackupRef.current = allPlugins
    reorderQueryBackupRef.current = query
    setQuery('')
    setReorderMode(true)
    showToast('进入拖拽排序模式：拖动列表，点右上角保存')
  }, [allPlugins, query, setQuery, showToast])

  const cancelReorder = useCallback(() => {
    const backup = reorderBackupRef.current
    if (backup) setAllPlugins(backup)
    setReorderMode(false)
    setDraggingId(null)
    setDragOverId(null)
    setDragOverAfter(false)
    setQuery(reorderQueryBackupRef.current)
    reorderBackupRef.current = null
    showToast('已取消排序')
  }, [setAllPlugins, setQuery, showToast])

  const saveReorder = useCallback(() => {
    persistPluginOrder(allPlugins)
    setReorderMode(false)
    setDraggingId(null)
    setDragOverId(null)
    setDragOverAfter(false)
    setQuery(reorderQueryBackupRef.current)
    reorderBackupRef.current = null
    showToast('排序已保存')
  }, [allPlugins, persistPluginOrder, setQuery, showToast])

  // Drag handlers
  const handlePointerDown = useCallback((e: React.PointerEvent, pluginId: string) => {
    if (!reorderMode) return
    if (e.button !== 0) return
    dragMovedRef.current = false
    setDraggingId(pluginId)
    setDragOverId(pluginId)
    setDragOverAfter(false)
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch {}
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
      const enabled = allPlugins.filter(p => !p.disabled)
      const nextEnabled = movePluginById(enabled, draggingId, targetId, dragOverAfter)
      if (nextEnabled !== enabled) {
        const nextAll: Plugin[] = []
        let enabledIndex = 0
        for (const p of allPlugins) {
          if (p.disabled) nextAll.push(p)
          else {
            const hit = nextEnabled[enabledIndex]
            enabledIndex += 1
            nextAll.push(hit || p)
          }
        }
        if (nextAll.length === allPlugins.length) setAllPlugins(nextAll)
      }
    }
    setDraggingId(null)
    setDragOverId(null)
    setDragOverAfter(false)
  }, [allPlugins, dragOverAfter, dragOverId, draggingId, reorderMode, setAllPlugins])

  // === Render helpers ===

  const showPluginView = !!activePlugin
  const activePluginId = activePlugin?.id || ''
  const activePluginKeepAlive = activePlugin?.manifest?.ui?.keepAlive === true
  const ActivePluginComponent = activePlugin ? activePlugin.component : null
  const activeBackendLifecycle = activePlugin ? resolveBackendLifecycle(activePlugin.manifest) : null
  const activePluginNeedsProcessBackend = Boolean(
    activePlugin &&
    Number(activePlugin.manifest?.apiVersion ?? 2) >= 3 &&
    String(activePlugin.manifest?.background?.main || '').trim(),
  )
  const activePluginBackendReady = !activePluginNeedsProcessBackend || backendController.isReady(activePluginId)
  const onBackFromPlugin = () => setActivePlugin(null)
  const renderKeepAliveUiPluginIds =
    activePluginKeepAlive && activePluginId && !keepAliveUiPluginIds.includes(activePluginId)
      ? keepAliveUiPluginIds.concat(activePluginId)
      : keepAliveUiPluginIds

  // Wallpaper
  const wallpaperUrl =
    wallpaper?.enabled && wallpaper.filePath ? `${convertFileSrc('wallpaper', 'wallpaper')}?rev=${wallpaper.rev ?? 0}` : ''
  const hasWallpaper = !!wallpaperUrl
  const wallpaperView = getWallpaperView(wallpaper)
  const canSwitchWallpaper = !!(
    wallpaper?.enabled && wallpaper.filePath &&
    Array.isArray(wallpaper.items) && wallpaper.items.length > 1
  )
  const titlebarOpacity = typeof wallpaper?.titlebarOpacity === 'number' ? wallpaper.titlebarOpacity : 0.62
  const titlebarBlur = typeof wallpaper?.titlebarBlur === 'number' ? wallpaper.titlebarBlur : 12

  const wallpaperLayer = wallpaperUrl ? (
    <Box
      aria-hidden
      sx={{
        position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none',
        opacity: Math.max(0, Math.min(1, wallpaper?.opacity ?? 0.65)),
      }}
    >
      <Box
        component="img" alt="" draggable={false} src={wallpaperUrl}
        sx={{
          position: 'absolute', inset: 0, width: '100%', height: '100%',
          objectFit: 'cover',
          objectPosition: `${wallpaperView.x}% ${wallpaperView.y}%`,
          transform: `scale(${wallpaperView.scale * 1.05})`,
          transformOrigin: `${wallpaperView.x}% ${wallpaperView.y}%`,
          filter: `blur(${Math.max(0, Math.min(40, wallpaper?.blur ?? 0))}px)`,
          userSelect: 'none',
        }}
      />
    </Box>
  ) : null

  const shellRootSx = { height: '100vh', outline: 'none' } as const
  const shellContainerSx = {
    height: '100%', display: 'flex', flexDirection: 'column',
    borderRadius: '0 0 16px 16px', overflow: 'hidden', bgcolor: 'background.default',
  } as const

  // Handle registered app activation
  const activeRegisteredApp = registeredAppFromListItem(registeredApps, activePluginId)

  // Loading state
  if (loading) {
    return (
      <Box onKeyDown={handleKeyDown} tabIndex={0} sx={shellRootSx}>
        <Box
          sx={[
            shellContainerSx,
            { position: 'relative', '& > :not([aria-hidden])': { position: 'relative', zIndex: 1 } } as any,
          ]}
        >
          {wallpaperLayer}
          <TitleBar title={APP_TITLE} translucent={hasWallpaper} translucentOpacity={titlebarOpacity} translucentBlur={titlebarBlur} />
          <Box sx={{ flex: 1, display: 'grid', placeItems: 'center' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
              <CircularProgress size={18} />
              <Typography variant="body2" color="text.secondary">加载插件中...</Typography>
            </Box>
          </Box>
        </Box>
        <ToastBar toast={toast} onClose={() => setToast(prev => ({ ...prev, open: false }))} />
        <PluginContextMenu
          plugin={pluginMenu?.plugin ?? null}
          mouseX={pluginMenu?.mouseX ?? 0}
          mouseY={pluginMenu?.mouseY ?? 0}
          actions={pluginMenuActions}
          onClose={closePluginMenu}
        />
        <PluginDetailDialog plugin={pluginDetail} pluginsDir={pluginsDir} backendStatusById={backendStatusById} onClose={() => setPluginDetail(null)} />
        <AppDetailDialog app={appDetail} status={appDetail ? registeredAppStatuses[appDetail.id] : undefined} onClose={() => setAppDetailId(null)} />
        <ImportPluginDialog
          open={importOpen}
          onClose={() => setImportOpen(false)}
          onInstalled={() => { showToast('插件已导入'); reloadPlugins() }}
        />
        {backgroundHosts}
      </Box>
    )
  }

  return (
    <Box onKeyDown={handleKeyDown} tabIndex={0} sx={shellRootSx}>
      <Box
        sx={[
          shellContainerSx,
          { position: 'relative', '& > :not([aria-hidden])': { position: 'relative', zIndex: 1 } } as any,
        ]}
      >
        {wallpaperLayer}
        {showPluginView ? null : (
          <TitleBar
            title={APP_TITLE}
            translucent={hasWallpaper}
            translucentOpacity={titlebarOpacity}
            translucentBlur={titlebarBlur}
            onPrevWallpaper={canSwitchWallpaper ? () => cycleWallpaper(-1) : undefined}
            onNextWallpaper={canSwitchWallpaper ? () => cycleWallpaper(1) : undefined}
            wallpaperSwitchDisabled={wallpaperSwitching}
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
            onStore={reorderMode ? undefined : () => setActivePlugin(storePlugin)}
            showDivider={false}
          />
        )}

        <Box sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          <Box sx={{ height: '100%', display: showPluginView ? 'block' : 'none', overflow: 'hidden' }}>
            {renderKeepAliveUiPluginIds.map(id => {
              const p = allPlugins.find(x => x.id === id) || null
              if (!p || p.disabled || p.manifest?.ui?.keepAlive !== true) return null
              const PluginComponent = p.component
              const visible = activePluginId === id
              return (
                <Box key={id} sx={{ height: '100%', display: visible ? 'block' : 'none', overflow: 'hidden' }}>
                  <PluginComponent onBack={onBackFromPlugin} />
                </Box>
              )
            })}

            {showPluginView && ActivePluginComponent && !activePluginKeepAlive && activePluginBackendReady ? (
              <Box sx={{ height: '100%', overflow: 'hidden' }}>
                {activeRegisteredApp ? (
                  <AppActivationView
                    app={activeRegisteredApp}
                    onBack={onBackFromPlugin}
                  />
                ) : activePluginId === settingsPlugin.id ? (
                  <SettingsView
                    onBack={onBackFromPlugin}
                    registeredApps={registeredApps}
                    onAddRegisteredApp={addRegisteredApp}
                    onRemoveRegisteredApp={removeRegisteredApp}
                    onUpdateRegisteredApp={updateRegisteredApp}
                    appRegistrationEditRequest={appRegistrationEditRequest}
                    onAppRegistrationEditRequestHandled={handleAppRegistrationEditRequestHandled}
                  />
                ) : (
                  <ActivePluginComponent onBack={onBackFromPlugin} />
                )}
              </Box>
            ) : null}
            {showPluginView && ActivePluginComponent && !activePluginKeepAlive && !activePluginBackendReady ? (
              <Box sx={{ height: '100%', display: 'grid', placeItems: 'center', p: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, color: 'text.secondary' }}>
                  <CircularProgress size={18} />
                  <Typography variant="body2">
                    正在启动插件后台{activeBackendLifecycle ? `（${activeBackendLifecycle.lifecycle}）` : ''}...
                  </Typography>
                </Box>
              </Box>
            ) : null}
          </Box>

          <Box sx={{ height: '100%', display: showPluginView ? 'none' : 'flex', flexDirection: 'column', minHeight: 0 }}>
            <Box sx={{ p: 2, bgcolor: 'transparent' }}>
              <TextField
                fullWidth autoFocus
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="输入关键词搜索插件..."
                variant="outlined"
                disabled={reorderMode}
                sx={{
                  '& .MuiOutlinedInput-root': {
                    '& .MuiOutlinedInput-notchedOutline': { border: 0 },
                    '&:hover .MuiOutlinedInput-notchedOutline': { border: 0 },
                    '&.Mui-focused': {
                      boxShadow: theme => `0 0 0 2px ${alpha(theme.palette.primary.main, 0.35)}`,
                    },
                  },
                }}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start"><SearchRoundedIcon fontSize="small" /></InputAdornment>
                  ),
                }}
                inputProps={{ 'aria-label': '搜索插件', autoComplete: 'off' }}
              />
            </Box>

            <Box sx={{ flex: 1, overflow: 'auto', p: 1 }}>
              {displayItems.length === 0 ? (
                <Box sx={{ py: 4, textAlign: 'center' }}>
                  <Typography variant="body2" color="text.secondary">没有找到插件</Typography>
                  {pluginsDir ? (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1, px: 2, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      插件目录：{pluginsDir}
                    </Typography>
                  ) : null}
                  <Box sx={{ mt: 1, display: 'flex', justifyContent: 'center', gap: 1, flexWrap: 'wrap' }}>
                    <Button size="small" variant="outlined" onClick={() => void invoke('open_plugins_dir').catch(() => {})}>
                      打开插件目录
                    </Button>
                    <Button size="small" variant="contained" onClick={() => setActivePlugin(storePlugin)} disabled={reorderMode} startIcon={<StorefrontRoundedIcon fontSize="small" />} sx={{ boxShadow: 'none' }}>
                      去插件商店
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
                              <Typography variant="caption">{r.pluginId}：{r.reason}</Typography>
                            </li>
                          ))}
                          {pluginRejected.length > 6 ? (
                            <li><Typography variant="caption" color="text.secondary">…还有 {pluginRejected.length - 6} 个（详情见控制台日志）</Typography></li>
                          ) : null}
                        </Box>
                      </Alert>
                    </Box>
                  ) : null}
                </Box>
              ) : (
                <PluginListView
                  plugins={displayItems}
                  activeIndex={activeIndex}
                  activePlugin={activePlugin}
                  browseLayout={browseLayout}
                  reorderMode={reorderMode}
                  draggingId={draggingId}
                  dragOverId={dragOverId}
                  dragOverAfter={dragOverAfter}
                  onSelect={handlePluginSelect}
                  onContextMenu={handleContextMenu}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                />
              )}
            </Box>
          </Box>
        </Box>
      </Box>
      <ToastBar toast={toast} onClose={() => setToast(prev => ({ ...prev, open: false }))} />
      <PluginContextMenu
        plugin={pluginMenu?.plugin ?? null}
        mouseX={pluginMenu?.mouseX ?? 0}
        mouseY={pluginMenu?.mouseY ?? 0}
        actions={pluginMenuActions}
        onClose={closePluginMenu}
      />
      <Dialog open={!!stopAppConfirm} onClose={closeStopAppConfirm} fullWidth maxWidth="xs">
        <DialogTitle>{stopAppConfirm ? appStopDialogTitle(stopAppConfirm.mode) : '停止 v5 应用'}</DialogTitle>
        <DialogContent sx={{ pt: '8px !important' }}>
          <Typography variant="body2">
            {stopAppConfirm ? appStopDialogDescription(stopAppConfirm.mode, stopAppConfirm.app.name) : ''}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button disabled={!!stoppingAppId} onClick={closeStopAppConfirm}>取消</Button>
          <Button
            color="error"
            variant="contained"
            disabled={!!stoppingAppId}
            onClick={() => void confirmStopApp()}
            sx={{ boxShadow: 'none' }}
          >
            {stopAppConfirm ? appStopConfirmLabel(stopAppConfirm.mode) : '停止'}
          </Button>
        </DialogActions>
      </Dialog>
      <PluginDetailDialog plugin={pluginDetail} pluginsDir={pluginsDir} backendStatusById={backendStatusById} onClose={() => setPluginDetail(null)} />
      <AppDetailDialog app={appDetail} status={appDetail ? registeredAppStatuses[appDetail.id] : undefined} onClose={() => setAppDetailId(null)} />
      <ImportPluginDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onInstalled={() => { showToast('插件已导入'); reloadPlugins() }}
      />
      {backgroundHosts}
    </Box>
  )
}

function ToastBar({ toast, onClose }: { toast: { open: boolean; message: string; key: number }; onClose: () => void }) {
  return (
    <Snackbar
      key={toast.key}
      open={toast.open}
      autoHideDuration={900}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      sx={{ mb: 4 }}
    >
      <Alert variant="filled" severity="success" onClose={onClose} sx={{ borderRadius: 999, py: 0.25, alignItems: 'center' }}>
        {toast.message}
      </Alert>
    </Snackbar>
  )
}

export default App
