import React, { ComponentType } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { normalizeManifest, PLUGIN_API_VERSION, PluginManifest } from './pluginContract'
import IframePluginView from './IframePluginView'

export interface LoadedPlugin {
  manifest: PluginManifest
  component: ComponentType<{ onBack: () => void }>
}

// 加载单个插件
async function loadPlugin(pluginPath: string): Promise<LoadedPlugin | null> {
  try {
    // 读取 manifest
    const manifestContent = await invoke<string>('read_plugin_file', { pluginId: pluginPath, path: 'manifest.json' })
    const rawManifest: PluginManifest = JSON.parse(manifestContent)
    const manifest = normalizeManifest(rawManifest)

    if (manifest.apiVersion > PLUGIN_API_VERSION) {
      console.error(`插件 ${manifest.id} 需要 apiVersion=${manifest.apiVersion}，当前宿主版本=${PLUGIN_API_VERSION}，已跳过加载`)
      return null
    }

    // 读取插件代码
    const code = await invoke<string>('read_plugin_file', { pluginId: pluginPath, path: manifest.main })

    if ((rawManifest.ui?.type ?? 'react') !== 'iframe') {
      console.error(`[plugin] "${manifest.id}" rejected: ui.type must be "iframe" (legacy eval/react is disabled).`)
      return null
    }

    const component: ComponentType<{ onBack: () => void }> = ({ onBack }) =>
      React.createElement(IframePluginView, {
        pluginId: manifest.id,
        pluginCode: code,
        requires: rawManifest.requires,
        onBack,
      })
    return { manifest, component }
  } catch (error) {
    console.error(`Failed to load plugin from ${pluginPath}:`, error)
    return null
  }
}

// 扫描并加载所有插件
export async function loadAllPlugins(_pluginsDir: string): Promise<LoadedPlugin[]> {
  const plugins: LoadedPlugin[] = []

  try {
    const pluginIds = await invoke<string[]>('list_plugins')

    for (const pluginId of pluginIds) {
      const plugin = await loadPlugin(pluginId)
      if (plugin) {
        plugins.push(plugin)
        console.log(`Loaded plugin: ${plugin.manifest.name}`)
      }
    }
  } catch (error) {
    console.error('Failed to scan plugins directory:', error)
  }

  return plugins
}
