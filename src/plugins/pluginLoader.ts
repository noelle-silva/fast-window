import React, { ComponentType } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { PLUGIN_API_VERSION, PluginManifest, PluginCapability, isValidPluginCapability } from './pluginContract'
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

function isDataImageUrl(value: string): boolean {
  return value.startsWith('data:image/')
}

async function resolvePluginIcon(pluginId: string, icon: unknown): Promise<string | undefined> {
  const raw = typeof icon === 'string' ? icon.trim() : ''
  if (!raw) return undefined
  if (isDataImageUrl(raw)) return raw

  if (raw.startsWith('svg:')) {
    const path = raw.slice('svg:'.length).trim()
    if (!path) return undefined
    if (!path.toLowerCase().endsWith('.svg')) {
      console.warn(`[plugin] "${pluginId}" icon ignored: svg: must point to a .svg file.`)
      return undefined
    }

    try {
      const svg = await invoke<string>('read_plugin_file', { pluginId, path })
      const encoded = encodeURIComponent(svg)
      return `data:image/svg+xml;utf8,${encoded}`
    } catch (e) {
      console.warn(`[plugin] "${pluginId}" icon ignored: failed to read svg icon "${path}".`, e)
      return undefined
    }
  }

  if (raw.startsWith('file:')) {
    const path = raw.slice('file:'.length).trim()
    if (!path) return undefined
    const lower = path.toLowerCase()

    const mime =
      lower.endsWith('.png') ? 'image/png'
      : (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) ? 'image/jpeg'
      : lower.endsWith('.webp') ? 'image/webp'
      : lower.endsWith('.gif') ? 'image/gif'
      : lower.endsWith('.ico') ? 'image/x-icon'
      : lower.endsWith('.svg') ? 'image/svg+xml'
      : ''

    if (!mime) {
      console.warn(`[plugin] "${pluginId}" icon ignored: unsupported file type "${path}".`)
      return undefined
    }

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
    const rawManifest: PluginManifest = JSON.parse(manifestContent)

    const isSafeId = (id: string) => /^[A-Za-z0-9_-]+$/.test(id)

    const manifestId = String(rawManifest?.id || '').trim()
    if (!manifestId || !isSafeId(manifestId)) {
      const reason = 'invalid manifest.id'
      console.error(`[plugin] rejected: ${reason} for "${pluginId}"`)
      return { plugin: null, rejection: { pluginId, reason } }
    }
    if (manifestId !== pluginId) {
      const reason = `manifest.id "${manifestId}" must match directory "${pluginId}"`
      console.error(`[plugin] rejected: ${reason}`)
      return { plugin: null, rejection: { pluginId, reason } }
    }

    if (rawManifest.apiVersion !== PLUGIN_API_VERSION) {
      const reason = `apiVersion mismatch: plugin=${rawManifest.apiVersion}, host=${PLUGIN_API_VERSION}`
      console.error(`插件 ${manifestId} 需要 apiVersion=${rawManifest.apiVersion}，当前宿主版本=${PLUGIN_API_VERSION}，已跳过加载`)
      return { plugin: null, rejection: { pluginId, reason } }
    }

    const uiType = rawManifest.ui?.type
    if (uiType !== 'iframe') {
      const reason = 'ui.type must be "iframe"'
      console.error(`[plugin] "${manifestId}" rejected: ${reason}.`)
      return { plugin: null, rejection: { pluginId, reason } }
    }

    const requires = rawManifest.requires
    if (!Array.isArray(requires)) {
      const reason = 'manifest.requires must be an array'
      console.error(`[plugin] "${manifestId}" rejected: ${reason}.`)
      return { plugin: null, rejection: { pluginId, reason } }
    }
    const normalizedRequires: PluginCapability[] = []
    for (const item of requires) {
      if (!isValidPluginCapability(item)) {
        const reason = `unknown capability "${String(item)}"`
        console.error(`[plugin] "${manifestId}" rejected: ${reason}.`)
        return { plugin: null, rejection: { pluginId, reason } }
      }
      normalizedRequires.push(String(item).trim() as PluginCapability)
    }

    const main = String(rawManifest.main || '').trim()
    if (!main) {
      const reason = 'manifest.main is required'
      console.error(`[plugin] "${manifestId}" rejected: ${reason}.`)
      return { plugin: null, rejection: { pluginId, reason } }
    }

    const manifest: PluginManifest = {
      ...rawManifest,
      id: manifestId,
      main,
      requires: normalizedRequires,
      icon: await resolvePluginIcon(manifestId, rawManifest.icon),
    }

    // 读取插件代码
    const code = await invoke<string>('read_plugin_file', { pluginId, path: manifest.main })

    let backgroundCode = ''
    if (rawManifest.background) {
      const bgMain = String(rawManifest.background.main || '').trim()
      if (bgMain) {
        backgroundCode = await invoke<string>('read_plugin_file', { pluginId, path: bgMain }).catch(() => '')
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
