import { PLUGIN_ID } from '../core'
import { requireTauri } from './hostGateway'
import type { FileGateway } from './types'

export function createFileGateway(baseApi: any): FileGateway {
  const base = baseApi || {}
  const tauri = requireTauri(base)
  return {
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
    async listDir(req: any) {
      return tauri.invoke({ command: 'plugin_files_list_dir', payload: { pluginId: PLUGIN_ID, req } })
    },
    async readText(req: any) {
      return tauri.invoke({ command: 'plugin_files_read_text', payload: { pluginId: PLUGIN_ID, req } })
    },
    async writeText(req: any) {
      return tauri.invoke({ command: 'plugin_files_write_text', payload: { pluginId: PLUGIN_ID, req } })
    },
    async readBase64(req: any) {
      return tauri.invoke({ command: 'plugin_files_read_base64', payload: { pluginId: PLUGIN_ID, req } })
    },
    async writeBase64(req: any) {
      return tauri.invoke({ command: 'plugin_files_write_base64', payload: { pluginId: PLUGIN_ID, req } })
    },
    async rename(req: any) {
      return tauri.invoke({ command: 'plugin_files_rename', payload: { pluginId: PLUGIN_ID, req } })
    },
    async delete(req: any) {
      return tauri.invoke({ command: 'plugin_files_delete', payload: { pluginId: PLUGIN_ID, req } })
    },
    async deleteTree(req: any) {
      return tauri.invoke({ command: 'plugin_files_delete_tree', payload: { pluginId: PLUGIN_ID, req } })
    },
    async pickImages(maxCount?: number | null) {
      return tauri.invoke({
        command: 'plugin_pick_images',
        payload: { pluginId: PLUGIN_ID, maxCount: maxCount == null ? null : Number(maxCount) },
      })
    },
    async getThumbnail(req: any) {
      return tauri.invoke({ command: 'plugin_files_thumbnail', payload: { pluginId: PLUGIN_ID, req } })
    },
  }
}
