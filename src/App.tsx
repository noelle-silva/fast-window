import { useState, useEffect, useCallback, ComponentType, useRef } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { invoke } from '@tauri-apps/api/core'
import { loadAllPlugins } from './plugins/pluginLoader'
import { initPluginApi } from './plugins/pluginApi'
import BackgroundPluginHost from './plugins/BackgroundPluginHost'
import { PluginCapability } from './plugins/pluginContract'
import {
  Alert,
  Avatar,
  Box,
  CircularProgress,
  IconButton,
  InputAdornment,
  List,
  ListItemAvatar,
  ListItemButton,
  ListItemText,
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
import SettingsView from './components/SettingsView'
import ImportPluginDialog from './components/ImportPluginDialog'

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
const APP_VERSION_TEXT = 'Fast Window v0.1.0'

const APP_STORAGE_ID = '__app'
const PLUGIN_ORDER_KEY = 'pluginOrder'

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

function StatusBar(props: { left?: string; right: string }) {
  const { left, right } = props
  return (
    <Box
      sx={{
        height: 32,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        px: 1.5,
        bgcolor: 'background.paper',
        borderTop: 1,
        borderColor: 'divider',
      }}
    >
      <Typography variant="caption" color="text.secondary" noWrap>
        {left ?? ''}
      </Typography>
      <Typography variant="caption" color="text.secondary" noWrap>
        {right}
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
  const [query, setQuery] = useState('')
  const [plugins, setPlugins] = useState<Plugin[]>([])
  const [allPlugins, setAllPlugins] = useState<Plugin[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [activePlugin, setActivePlugin] = useState<Plugin | null>(null)
  const [loading, setLoading] = useState(true)
  const [importOpen, setImportOpen] = useState(false)
  const [reorderMode, setReorderMode] = useState(false)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [dragOverAfter, setDragOverAfter] = useState(false)
  const selectedIdRef = useRef<string | null>(null)
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
      const pluginsDir = await invoke<string>('get_plugins_dir')
      console.log('Plugins directory:', pluginsDir)

      const loaded = await loadAllPlugins(pluginsDir)
      console.log('Loaded plugins:', loaded.length)

      const pluginList: Plugin[] = loaded.map(p => ({
        id: p.manifest.id,
        name: p.manifest.name,
        description: p.manifest.description,
        icon: p.manifest.icon || '📦',
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
    borderRadius: '16px',
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
          <StatusBar right={APP_VERSION_TEXT} />
        </Paper>
        {toastHost}
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
          <StatusBar right={APP_VERSION_TEXT} />
        </Paper>
        {toastHost}
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
            </Box>
          ) : (
            <List disablePadding sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              {plugins.map((plugin, index) => (
                <ListItemButton
                  key={plugin.id}
                  data-plugin-id={plugin.id}
                  selected={index === activeIndex}
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
                      sx={theme => ({
                        width: 32,
                        height: 32,
                        fontSize: 18,
                        bgcolor: theme.palette.action.hover,
                        color: theme.palette.text.primary,
                      })}
                    >
                      {plugin.icon}
                    </Avatar>
                  </ListItemAvatar>
                  <ListItemText
                    primary={plugin.name}
                    secondary={plugin.description}
                    primaryTypographyProps={{ variant: 'body1', fontWeight: 600 }}
                    secondaryTypographyProps={{ variant: 'body2', color: 'text.secondary', noWrap: true }}
                  />
                </ListItemButton>
              ))}
            </List>
          )}
        </Box>

        <StatusBar
          left={reorderMode ? '拖拽排序模式：拖动条目 · 右上角保存/取消 · ESC 隐藏' : '↑↓ 选择 · Enter 打开 · ESC 隐藏'}
          right={APP_VERSION_TEXT}
        />
      </Paper>
      {toastHost}
      {importDialog}
      {backgroundHosts}
    </Box>
  )
}

export default App
