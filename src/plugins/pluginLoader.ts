import React, { ComponentType } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { ALL_PLUGIN_CAPABILITIES, PLUGIN_API_VERSION, PluginManifest, PluginCapability } from './pluginContract'
import IframePluginView from './IframePluginView'

export interface LoadedPlugin {
  manifest: PluginManifest
  component: ComponentType<{ onBack: () => void }>
  backgroundCode?: string
}

export type PluginLoadRejection = {
  pluginId: string
  reason: string
}

// 加载单个插件
async function loadPlugin(pluginPath: string): Promise<{ plugin: LoadedPlugin | null; rejection?: PluginLoadRejection }> {
  try {
    // 读取 manifest
    const manifestContent = await invoke<string>('read_plugin_file', { pluginId: pluginPath, path: 'manifest.json' })
    const rawManifest: PluginManifest = JSON.parse(manifestContent)

    const isSafeId = (id: string) => /^[A-Za-z0-9_-]+$/.test(id)

    const manifestId = String(rawManifest?.id || '').trim()
    if (!manifestId || !isSafeId(manifestId)) {
      const reason = 'invalid manifest.id'
      console.error(`[plugin] rejected: ${reason} for "${pluginPath}"`)
      return { plugin: null, rejection: { pluginId: pluginPath, reason } }
    }
    if (manifestId !== pluginPath) {
      const reason = `manifest.id "${manifestId}" must match directory "${pluginPath}"`
      console.error(`[plugin] rejected: ${reason}`)
      return { plugin: null, rejection: { pluginId: pluginPath, reason } }
    }

    if (rawManifest.apiVersion !== PLUGIN_API_VERSION) {
      const reason = `apiVersion mismatch: plugin=${rawManifest.apiVersion}, host=${PLUGIN_API_VERSION}`
      console.error(`插件 ${manifestId} 需要 apiVersion=${rawManifest.apiVersion}，当前宿主版本=${PLUGIN_API_VERSION}，已跳过加载`)
      return { plugin: null, rejection: { pluginId: pluginPath, reason } }
    }

    const uiType = rawManifest.ui?.type
    if (uiType !== 'iframe') {
      const reason = 'ui.type must be "iframe"'
      console.error(`[plugin] "${manifestId}" rejected: ${reason}.`)
      return { plugin: null, rejection: { pluginId: pluginPath, reason } }
    }

    const requires = rawManifest.requires
    if (!Array.isArray(requires)) {
      const reason = 'manifest.requires must be an array'
      console.error(`[plugin] "${manifestId}" rejected: ${reason}.`)
      return { plugin: null, rejection: { pluginId: pluginPath, reason } }
    }
    const known = new Set<string>(ALL_PLUGIN_CAPABILITIES as readonly string[])
    for (const item of requires) {
      if (!known.has(String(item))) {
        const reason = `unknown capability "${String(item)}"`
        console.error(`[plugin] "${manifestId}" rejected: ${reason}.`)
        return { plugin: null, rejection: { pluginId: pluginPath, reason } }
      }
    }

    const main = String(rawManifest.main || '').trim()
    if (!main) {
      const reason = 'manifest.main is required'
      console.error(`[plugin] "${manifestId}" rejected: ${reason}.`)
      return { plugin: null, rejection: { pluginId: pluginPath, reason } }
    }

    const manifest: PluginManifest = {
      ...rawManifest,
      id: manifestId,
      main,
      requires: requires as PluginCapability[],
    }

    // 读取插件代码
    const code = await invoke<string>('read_plugin_file', { pluginId: pluginPath, path: manifest.main })

    let backgroundCode = ''
    if (rawManifest.background) {
      const bgMain = String(rawManifest.background.main || '').trim()
      if (bgMain) {
        backgroundCode = await invoke<string>('read_plugin_file', { pluginId: pluginPath, path: bgMain }).catch(() => '')
      } else {
        backgroundCode = code
      }
    }

    const component: ComponentType<{ onBack: () => void }> = ({ onBack }) =>
      React.createElement(IframePluginView, {
        pluginId: manifest.id,
        pluginCode: code,
        requires: manifest.requires,
        onBack,
      })
    return { plugin: { manifest, component, backgroundCode: backgroundCode || undefined } }
  } catch (error) {
    const reason = String((error as any)?.message || error || 'failed to load plugin')
    console.error(`Failed to load plugin from ${pluginPath}:`, error)
    return { plugin: null, rejection: { pluginId: pluginPath, reason } }
  }
}

// 扫描并加载所有插件
export async function loadAllPlugins(_pluginsDir: string): Promise<LoadedPlugin[]> {
  const report = await loadAllPluginsReport()
  return report.plugins
}

export async function loadAllPluginsReport(): Promise<{
  pluginIds: string[]
  plugins: LoadedPlugin[]
  rejected: PluginLoadRejection[]
}> {
  const plugins: LoadedPlugin[] = []
  const rejected: PluginLoadRejection[] = []
  let pluginIds: string[] = []

  try {
    pluginIds = await invoke<string[]>('list_plugins')

    for (const pluginId of pluginIds) {
      const { plugin, rejection } = await loadPlugin(pluginId)
      if (plugin) {
        plugins.push(plugin)
        console.log(`Loaded plugin: ${plugin.manifest.name}`)
      } else if (rejection) {
        rejected.push(rejection)
      }
    }
  } catch (error) {
    console.error('Failed to scan plugins directory:', error)
  }

  return { pluginIds, plugins, rejected }
}
