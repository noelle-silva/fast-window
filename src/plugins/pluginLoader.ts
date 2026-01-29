import React, { ComponentType } from 'react'
import { readDir, readTextFile } from '@tauri-apps/plugin-fs'
import { createPluginContext } from './pluginApi'
import { normalizeManifest, PLUGIN_API_VERSION, PluginManifest } from './pluginContract'
import IframePluginView from './IframePluginView'

export interface LoadedPlugin {
  manifest: PluginManifest
  component: ComponentType<{ onBack: () => void }>
}

// 已注册的插件组件（由插件代码调用 registerPlugin 填充）
const pendingPlugins = new Map<string, ComponentType<any>>()

// 供插件调用的注册函数
;(window as any).registerPluginComponent = (id: string, component: ComponentType<any>) => {
  pendingPlugins.set(id, component)
}

// 加载单个插件
async function loadPlugin(pluginPath: string): Promise<LoadedPlugin | null> {
  try {
    // 读取 manifest
    const manifestPath = `${pluginPath}/manifest.json`
    const manifestContent = await readTextFile(manifestPath)
    const rawManifest: PluginManifest = JSON.parse(manifestContent)
    const manifest = normalizeManifest(rawManifest)

    if (manifest.apiVersion > PLUGIN_API_VERSION) {
      console.error(`插件 ${manifest.id} 需要 apiVersion=${manifest.apiVersion}，当前宿主版本=${PLUGIN_API_VERSION}，已跳过加载`)
      return null
    }

    // 读取插件代码
    const codePath = `${pluginPath}/${manifest.main}`
    const code = await readTextFile(codePath)

    if ((rawManifest.ui?.type ?? 'react') === 'iframe') {
      const component: ComponentType<{ onBack: () => void }> = ({ onBack }) =>
        React.createElement(IframePluginView, {
          pluginId: manifest.id,
          pluginCode: code,
          requires: rawManifest.requires,
          onBack,
        })
      return { manifest, component }
    }

    console.warn(`[plugin] "${manifest.id}" uses deprecated ui.type="react" (eval). Prefer ui.type="iframe".`)

    // 执行插件代码
    const prevFastWindow = (window as any).fastWindow
    const prevCtx = (window as any).__fastWindowPluginContext

    const ctx = createPluginContext(manifest.id, rawManifest.requires)
    ;(window as any).__fastWindowPluginContext = {
      id: manifest.id,
      apiVersion: ctx.apiVersion,
      requires: rawManifest.requires ?? [],
      ui: rawManifest.ui?.type ?? 'react',
    }
    ;(window as any).fastWindow = ctx.api

    try {
      const wrappedCode = `(function() { ${code} })();`
      eval(wrappedCode)
    } finally {
      ;(window as any).fastWindow = prevFastWindow
      ;(window as any).__fastWindowPluginContext = prevCtx
    }

    // 获取注册的组件
    const component = pendingPlugins.get(manifest.id)
    if (!component) {
      console.error(`Plugin ${manifest.id} did not register a component`)
      return null
    }
    pendingPlugins.delete(manifest.id)

    return { manifest, component }
  } catch (error) {
    console.error(`Failed to load plugin from ${pluginPath}:`, error)
    return null
  }
}

// 扫描并加载所有插件
export async function loadAllPlugins(pluginsDir: string): Promise<LoadedPlugin[]> {
  const plugins: LoadedPlugin[] = []

  try {
    const entries = await readDir(pluginsDir)

    for (const entry of entries) {
      if (entry.isDirectory) {
        const pluginPath = `${pluginsDir}/${entry.name}`
        const plugin = await loadPlugin(pluginPath)
        if (plugin) {
          plugins.push(plugin)
          console.log(`Loaded plugin: ${plugin.manifest.name}`)
        }
      }
    }
  } catch (error) {
    console.error('Failed to scan plugins directory:', error)
  }

  return plugins
}
