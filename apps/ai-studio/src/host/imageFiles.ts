export function createImageFilesApi(tauri: any, pluginId: string) {
  return {
    pickImages: async (maxCount?: any) => {
      return tauri.invoke({
        command: 'plugin_pick_images',
        payload: { pluginId: String(pluginId || ''), maxCount: maxCount == null ? null : Number(maxCount) },
      })
    },
    images: {
      writeBase64: async (req: any) => {
        return tauri.invoke({ command: 'plugin_images_write_base64', payload: { pluginId: String(pluginId || ''), req } })
      },
      read: async (req: any) => {
        return tauri.invoke({ command: 'plugin_images_read', payload: { pluginId: String(pluginId || ''), req } })
      },
      delete: async (req: any) => {
        return tauri.invoke({ command: 'plugin_images_delete', payload: { pluginId: String(pluginId || ''), req } })
      },
    },
  }
}
