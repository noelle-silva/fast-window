import { PLUGIN_ID } from '../core'
import { createToast } from './toast'
import type { HostGateway } from './types'

type TauriLike = { invoke: (req: { command: string; payload?: any }) => Promise<any> }

export function requireTauri(baseApi: any): TauriLike {
  const tauri: TauriLike | null = baseApi?.tauri || null
  if (!tauri || typeof tauri.invoke !== 'function') throw new Error('tauri.invoke 不可用（请更新宿主网关）')
  return tauri
}

export function createHostGateway(baseApi: any): HostGateway {
  const base = baseApi || {}
  const tauri = requireTauri(base)
  const baseToast = base?.ui && typeof base.ui.showToast === 'function' ? ((message: string) => base.ui.showToast(message)) : null
  const toast = createToast()

  return {
    async toast(message: string) {
      const m = String(message ?? '').trim()
      if (!m) return
      if (baseToast) return baseToast(m)
      toast(m)
    },
    async back() {
      if (typeof base?.ui?.back === 'function') return base.ui.back()
      if (typeof base?.host?.back === 'function') return base.host.back()
      throw new Error('无法返回')
    },
    async startDragging() {
      try {
        await tauri.invoke({ command: 'plugin:window|start_dragging', payload: {} })
      } catch (e: any) {
        const msg = String(e?.message || e || '无法拖拽')
        if (baseToast) return baseToast(msg)
        console.log(`[HyperCortex] ${msg}`)
      }
    },
    async getLibraryDir() {
      return tauri.invoke({ command: 'plugin_get_library_dir', payload: { pluginId: PLUGIN_ID } })
    },
    async pickLibraryDir() {
      return tauri.invoke({ command: 'plugin_pick_library_dir', payload: { pluginId: PLUGIN_ID } })
    },
    async openDir(dir: string) {
      const s = String(dir || '').trim()
      if (!s) throw new Error('dir 不能为空')
      return tauri.invoke({ command: 'plugin_open_dir', payload: { pluginId: PLUGIN_ID, dir: s } })
    },
  }
}
