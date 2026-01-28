import { useState, useEffect, useCallback, ComponentType } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { invoke } from '@tauri-apps/api/core'
import { loadAllPlugins, LoadedPlugin } from './plugins/pluginLoader'
import { initPluginApi } from './plugins/pluginApi'
import * as React from 'react'

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

function App() {
  const [query, setQuery] = useState('')
  const [plugins, setPlugins] = useState<Plugin[]>([])
  const [allPlugins, setAllPlugins] = useState<Plugin[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [activePlugin, setActivePlugin] = useState<Plugin | null>(null)
  const [loading, setLoading] = useState(true)

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

  // 加载中
  if (loading) {
    return (
      <div className="app-container">
        <div className="titlebar">
          <span className="titlebar-title">Fast Window</span>
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span>加载插件中...</span>
        </div>
      </div>
    )
  }

  // 如果有激活的插件，渲染插件视图
  if (activePlugin) {
    const PluginComponent = activePlugin.component
    return (
      <div className="app-container" onKeyDown={handleKeyDown} tabIndex={0}>
        <div className="titlebar">
          <button className="back-btn" onClick={() => setActivePlugin(null)}>←</button>
          <span className="titlebar-title">{activePlugin.name}</span>
        </div>
        <PluginComponent onBack={() => setActivePlugin(null)} />
        <div className="status-bar">
          <span></span>
          <span>Fast Window v0.1.0</span>
        </div>
      </div>
    )
  }

  return (
    <div className="app-container" onKeyDown={handleKeyDown} tabIndex={0}>
      <div className="titlebar">
        <span className="titlebar-title">Fast Window</span>
      </div>
      <div className="search-container">
        <input
          className="search-input"
          placeholder="输入关键词搜索插件..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          autoFocus
        />
      </div>
      <div className="plugin-list">
        {plugins.length === 0 ? (
          <div style={{ padding: '20px', textAlign: 'center', color: '#666' }}>
            没有找到插件
          </div>
        ) : (
          plugins.map((plugin, index) => (
            <div
              key={plugin.id}
              className={`plugin-item ${index === activeIndex ? 'active' : ''}`}
              onClick={() => setActivePlugin(plugin)}
            >
              <div className="plugin-icon">{plugin.icon}</div>
              <div className="plugin-info">
                <div className="plugin-name">{plugin.name}</div>
                <div className="plugin-desc">{plugin.description}</div>
              </div>
            </div>
          ))
        )}
      </div>
      <div className="status-bar">
        <span>↑↓ 选择 · Enter 打开 · ESC 隐藏</span>
        <span>Fast Window v0.1.0</span>
      </div>
    </div>
  )
}

export default App
