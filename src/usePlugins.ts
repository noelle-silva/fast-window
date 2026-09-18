import { useState, useCallback, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { Plugin, PluginBrowseLayout } from './constants'
import {
  APP_STORAGE_ID, PLUGIN_ORDER_KEY, DISABLED_PLUGINS_KEY, PLUGIN_BROWSE_LAYOUT_KEY,
} from './constants'
import { loadAllPluginsReport, loadPluginById, type PluginLoadRejection } from './plugins/pluginLoader'
import {
  normalizeDisabledPlugins, normalizeOrder, normalizeBrowseLayout,
  applyPluginOrder,
} from './utils'
import { readIconImageDataUrl, type IconImageSource } from './iconImageInput'

interface ToastFn {
  (message: string): void
}

export type PluginUninstallResult = {
  pluginId: string
  deletedData: boolean
  warnings: string[]
}

export function usePlugins(toast: ToastFn) {
  const [plugins, setPlugins] = useState<Plugin[]>([])
  const [allPlugins, setAllPlugins] = useState<Plugin[]>([])
  const [pluginsDir, setPluginsDir] = useState<string>('')
  const [pluginRejected, setPluginRejected] = useState<PluginLoadRejection[]>([])
  const [browseLayout, setBrowseLayout] = useState<PluginBrowseLayout>('list')
  const [loading, setLoading] = useState(true)
  const [refreshingId, setRefreshingId] = useState<string | null>(null)
  const allPluginsRef = useRef<Plugin[]>([])

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

      const iconOverrides = await invoke<Record<string, string>>('get_plugin_icon_overrides').catch(() => ({} as Record<string, string>))

      const disabledSaved = await invoke<unknown | null>('storage_get', { pluginId: APP_STORAGE_ID, key: DISABLED_PLUGINS_KEY }).catch(() => null)
      const disabledSet = new Set(normalizeDisabledPlugins(disabledSaved))

      const pluginList: Plugin[] = report.plugins.map(p => ({
        id: p.manifest.id,
        name: p.manifest.name,
        description: p.manifest.description,
        icon: iconOverrides[p.manifest.id] || p.manifest.icon || '📦',
        keyword: p.manifest.keyword,
        requires: p.manifest.requires,
        backgroundCode: p.backgroundCode,
        manifest: p.manifest,
        disabled: disabledSet.has(p.manifest.id),
        component: p.component,
      }))

      const saved = await invoke<unknown | null>('storage_get', { pluginId: APP_STORAGE_ID, key: PLUGIN_ORDER_KEY }).catch(() => null)
      const ordered = applyPluginOrder(pluginList, normalizeOrder(saved))

      setAllPlugins(ordered)
      setPlugins(ordered)
      allPluginsRef.current = ordered
      if (opts?.showToast) {
        toast('插件已刷新')
      }
    } catch (error) {
      console.error('Failed to load plugins:', error)
    } finally {
      setLoading(false)
    }
  }, [toast])

  const reloadPlugins = useCallback(() => loadPlugins({ showToast: true }), [loadPlugins])

  const refreshPlugin = useCallback(async (plugin: Plugin) => {
    if (loading) return
    if (refreshingId === plugin.id) return

    setRefreshingId(plugin.id)
    try {
      const dir = await invoke<string>('get_plugins_dir').catch(() => '')
      if (dir) setPluginsDir(dir)

      const disabledSaved = await invoke<unknown | null>('storage_get', { pluginId: APP_STORAGE_ID, key: DISABLED_PLUGINS_KEY }).catch(() => null)
      const disabledSet = new Set(normalizeDisabledPlugins(disabledSaved))

      const { plugin: loaded, rejection } = await loadPluginById(plugin.id)
      if (!loaded) {
        const msg = rejection?.reason ? `刷新失败：${rejection.reason}` : '刷新失败（详情见控制台）'
        toast(msg)
        setPluginRejected(prev => {
          const rest = prev.filter(r => r.pluginId !== plugin.id)
          return rejection ? rest.concat(rejection) : rest
        })
        return
      }

      const iconOverrides = await invoke<Record<string, string>>('get_plugin_icon_overrides').catch(() => ({} as Record<string, string>))
      const icon = iconOverrides[plugin.id] || loaded.manifest.icon || plugin.icon || '📦'

      const updated: Plugin = {
        ...plugin,
        name: loaded.manifest.name,
        description: loaded.manifest.description,
        icon,
        keyword: loaded.manifest.keyword,
        requires: loaded.manifest.requires,
        backgroundCode: loaded.backgroundCode,
        manifest: loaded.manifest,
        disabled: disabledSet.has(plugin.id),
        component: loaded.component,
      }

      setAllPlugins(prev => {
        const idx = prev.findIndex(p => p.id === plugin.id)
        if (idx < 0) return prev
        const next = prev.slice()
        next[idx] = updated
        allPluginsRef.current = next
        return next
      })

      setPluginRejected(prev => prev.filter(r => r.pluginId !== plugin.id))
      toast(`已刷新：${updated.name}`)
    } catch (e) {
      console.error('Failed to refresh plugin:', e)
      toast('刷新失败（详情见控制台）')
    } finally {
      setRefreshingId(null)
    }
  }, [loading, refreshingId, toast])

  const persistPluginOrder = useCallback((orderedPlugins: Plugin[]) => {
    const ids = orderedPlugins.map(p => p.id)
    void invoke('storage_set', { pluginId: APP_STORAGE_ID, key: PLUGIN_ORDER_KEY, value: ids }).catch(e => {
      console.error('Failed to persist plugin order:', e)
    })
  }, [])

  const toggleBrowseLayout = useCallback(() => {
    setBrowseLayout(prev => {
      const next: PluginBrowseLayout = prev === 'list' ? 'grid' : prev === 'grid' ? 'icon' : 'list'
      void invoke('storage_set', { pluginId: APP_STORAGE_ID, key: PLUGIN_BROWSE_LAYOUT_KEY, value: next }).catch(() => {})
      return next
    })
  }, [])

  const changePluginIcon = useCallback(async (plugin: Plugin, source: IconImageSource) => {
    try {
      const dataUrl = await readIconImageDataUrl(source)
      if (!dataUrl) return
      await invoke('set_plugin_icon_override', { pluginId: plugin.id, dataUrl })
      toast('图标已更新')
      void loadPlugins()
    } catch (e) {
      console.error('Failed to change plugin icon:', e)
      const msg = typeof e === 'string' ? e : typeof (e as any)?.message === 'string' ? (e as any).message : ''
      toast(msg ? `更改图标失败：${msg}` : '更改图标失败')
    }
  }, [loadPlugins, toast])

  const resetPluginIcon = useCallback(async (plugin: Plugin) => {
    try {
      await invoke('remove_plugin_icon_override', { pluginId: plugin.id })
      toast('已恢复默认图标')
      void loadPlugins()
    } catch (e) {
      console.error('Failed to reset plugin icon:', e)
      toast('恢复默认图标失败（详情见控制台）')
    }
  }, [loadPlugins, toast])

  const uninstallPlugin = useCallback(async (plugin: Plugin, deleteData: boolean): Promise<PluginUninstallResult> => {
    const result = await invoke<PluginUninstallResult>('uninstall_plugin', { pluginId: plugin.id, deleteData })
    setPluginRejected(prev => prev.filter(r => r.pluginId !== plugin.id))
    setAllPlugins(prev => {
      const next = prev.filter(p => p.id !== plugin.id)
      allPluginsRef.current = next
      return next
    })
    setPlugins(prev => prev.filter(p => p.id !== plugin.id))
    await loadPlugins()
    return result
  }, [loadPlugins])

  // Load browse layout preference
  const loadBrowseLayout = useCallback(async () => {
    try {
      const saved = await invoke<unknown | null>('storage_get', { pluginId: APP_STORAGE_ID, key: PLUGIN_BROWSE_LAYOUT_KEY })
      setBrowseLayout(normalizeBrowseLayout(saved))
    } catch {}
  }, [])

  return {
    plugins, setPlugins,
    allPlugins, setAllPlugins,
    pluginsDir,
    pluginRejected,
    browseLayout,
    loading,
    refreshingId,
    allPluginsRef,
    loadPlugins,
    reloadPlugins,
    refreshPlugin,
    persistPluginOrder,
    toggleBrowseLayout,
    changePluginIcon,
    resetPluginIcon,
    uninstallPlugin,
    loadBrowseLayout,
  }
}
