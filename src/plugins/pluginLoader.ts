import { ComponentType } from 'react'
import { readDir, readTextFile } from '@tauri-apps/plugin-fs'
import { resolve, appDataDir } from '@tauri-apps/api/path'

export interface PluginManifest {
  id: string
  name: string
  version: string
  description: string
  main: string
  icon?: string
  keyword?: string
}

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
    const manifest: PluginManifest = JSON.parse(manifestContent)

    // 读取插件代码
    const codePath = `${pluginPath}/${manifest.main}`
    const code = await readTextFile(codePath)

    // 执行插件代码
    const wrappedCode = `(function() { ${code} })();`
    eval(wrappedCode)

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
