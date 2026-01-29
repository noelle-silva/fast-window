import { useState, useEffect, useCallback, ComponentType } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { invoke } from '@tauri-apps/api/core'
import { loadAllPlugins } from './plugins/pluginLoader'
import { initPluginApi } from './plugins/pluginApi'
import * as React from 'react'
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
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'

// 暴露 React 给插件使用
;(window as any).React = React

// 初始化插件 API
initPluginApi()

interface Plugin {
  id: string
  name: string
  description: string
  icon: string
  keyword?: string
  component: ComponentType<{ onBack: () => void }>
}

const APP_TITLE = 'Fast Window'
const APP_VERSION_TEXT = 'Fast Window v0.1.0'

function TitleBar(props: { title: string; onBack?: () => void }) {
  const { title, onBack } = props
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
        <IconButton
          data-tauri-drag-region="false"
          aria-label="返回"
          size="small"
          onClick={onBack}
          sx={{ position: 'absolute', left: 6, WebkitAppRegion: 'no-drag' }}
        >
          <ArrowBackRoundedIcon fontSize="small" />
        </IconButton>
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

function App() {
  const [query, setQuery] = useState('')
  const [plugins, setPlugins] = useState<Plugin[]>([])
  const [allPlugins, setAllPlugins] = useState<Plugin[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [activePlugin, setActivePlugin] = useState<Plugin | null>(null)
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<{ open: boolean; message: string; key: number }>({
    open: false,
    message: '',
    key: 0,
  })

  // 加载插件
  useEffect(() => {
    async function loadPlugins() {
      try {
        // 从 Rust 端获取插件目录的绝对路径
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
          component: p.component,
        }))

        setAllPlugins(pluginList)
        setPlugins(pluginList)
      } catch (error) {
        console.error('Failed to load plugins:', error)
      } finally {
        setLoading(false)
      }
    }

    loadPlugins()
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
    if (query.trim() === '') {
      setPlugins(allPlugins)
    } else {
      const filtered = allPlugins.filter(p =>
        p.name.toLowerCase().includes(query.toLowerCase()) ||
        p.keyword?.toLowerCase() === query.toLowerCase()
      )
      setPlugins(filtered)
    }
    setActiveIndex(0)
  }, [query, allPlugins])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex(i => Math.min(i + 1, plugins.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && plugins[activeIndex]) {
      e.preventDefault()
      setActivePlugin(plugins[activeIndex])
    } else if (e.key === 'Escape') {
      if (activePlugin) {
        setActivePlugin(null)
      } else {
        getCurrentWindow().hide()
      }
    }
  }, [plugins, activeIndex, activePlugin])

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
          <Box sx={{ flex: 1, overflow: 'auto' }}>
            <PluginComponent onBack={() => setActivePlugin(null)} />
          </Box>
          <StatusBar right={APP_VERSION_TEXT} />
        </Paper>
        {toastHost}
      </Box>
    )
  }

  return (
    <Box onKeyDown={handleKeyDown} tabIndex={0} sx={shellRootSx}>
      <Paper variant="outlined" sx={shellContainerSx}>
        <TitleBar title={APP_TITLE} />

        <Box sx={{ p: 2, bgcolor: 'background.paper', borderBottom: 1, borderColor: 'divider' }}>
          <TextField
            fullWidth
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="输入关键词搜索插件..."
            variant="outlined"
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
                  selected={index === activeIndex}
                  onClick={() => setActivePlugin(plugin)}
                  sx={{
                    py: 1,
                    px: 1.25,
                    '&.Mui-selected': { bgcolor: 'action.selected' },
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

        <StatusBar left="↑↓ 选择 · Enter 打开 · ESC 隐藏" right={APP_VERSION_TEXT} />
      </Paper>
      {toastHost}
    </Box>
  )
}

export default App
