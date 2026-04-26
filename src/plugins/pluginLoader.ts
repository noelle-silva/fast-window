import React, { ComponentType } from 'react'
import { invoke } from '@tauri-apps/api/core'
import {
  type PluginApiVersion,
  PluginManifest,
} from './pluginContract'
import IframePluginView from './IframePluginView'
import TrustedPluginView from './TrustedPluginView'
import { parsePluginManifest } from './manifest/parsePluginManifest'
import { isTrustedLocalApp, usesSystemBackend } from './pluginProfiles'
import { getPluginAssetMime, isDataImageUrl, resolveLocalPluginIconPath } from './pluginIcon'

export interface LoadedPlugin {
  manifest: PluginManifest
  component: ComponentType<{ onBack: () => void }>
  backgroundCode?: string
}

export type PluginLoadRejection = {
  pluginId: string
  reason: string
}

async function resolvePluginIcon(pluginId: string, icon: unknown): Promise<string | undefined> {
  const raw = typeof icon === 'string' ? icon.trim() : ''
  if (!raw) return undefined
  if (isDataImageUrl(raw)) return raw

  const path = resolveLocalPluginIconPath(raw)
  const mime = path ? getPluginAssetMime(path) : ''
  if (mime) {
    try {
      const b64 = await invoke<string>('read_plugin_file_base64', { pluginId, path })
      return `data:${mime};base64,${b64}`
    } catch (e) {
      console.warn(`[plugin] "${pluginId}" icon ignored: failed to read icon file "${path}".`, e)
      return undefined
    }
  }

  return raw
}

// 加载单个插件
export async function loadPluginById(pluginId: string): Promise<{ plugin: LoadedPlugin | null; rejection?: PluginLoadRejection }> {
  try {
    // 读取 manifest
    const manifestContent = await invoke<string>('read_plugin_file', { pluginId, path: 'manifest.json' })
    const parsed = parsePluginManifest(pluginId, manifestContent)
    if (!parsed.ok) {
      const reason = parsed.reason
      console.error(`[plugin] "${pluginId}" rejected: ${reason}.`)
      return { plugin: null, rejection: { pluginId, reason } }
    }

    for (const w of parsed.warnings) console.warn(`[plugin] "${pluginId}" manifest warning: ${w}`)

    const apiVersion = parsed.manifest.apiVersion as PluginApiVersion

    const manifest: PluginManifest = {
      ...parsed.manifest,
      icon: await resolvePluginIcon(parsed.manifest.id, parsed.manifest.icon),
    }

    // 读取插件代码
    const code = await invoke<string>('read_plugin_file', { pluginId, path: manifest.main })

    let backgroundCode = ''
    if (manifest.background && !usesSystemBackend(apiVersion)) {
      const bgMain = String(manifest.background.main || '').trim()
      if (bgMain) {
        backgroundCode = await invoke<string>('read_plugin_file', { pluginId, path: bgMain }).catch(() => '')
      } else {
        backgroundCode = code
      }
    }

    const View = isTrustedLocalApp(apiVersion) ? TrustedPluginView : IframePluginView
    const component: ComponentType<{ onBack: () => void }> = ({ onBack }) =>
      React.createElement(View, {
        pluginId: manifest.id,
        pluginCode: code,
        pluginMain: manifest.main,
        apiVersion,
        requires: manifest.requires,
        onBack,
      })
    return { plugin: { manifest, component, backgroundCode: backgroundCode || undefined } }
  } catch (error) {
    const reason = String((error as any)?.message || error || 'failed to load plugin')
    console.error(`Failed to load plugin "${pluginId}":`, error)
    return { plugin: null, rejection: { pluginId, reason } }
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
      const { plugin, rejection } = await loadPluginById(pluginId)
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
