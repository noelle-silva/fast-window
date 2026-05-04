export function createClipboardApi(tauri: any) {
  return {
    writeText: async (text: any) => {
      const s = String(text ?? '')
      await tauri.invoke({ command: 'plugin:clipboard-manager|write_text', payload: { text: s } })
    },
    writeImage: async (dataUrl: any) => {
      const u = String(dataUrl ?? '').trim()
      if (!u || !u.startsWith('data:')) throw new Error('writeImage only supports data URL currently')
      await tauri.invoke({ command: 'clipboard_write_image_data_url', payload: { dataUrl: u } })
    },
    readText: async () => {
      const r = await tauri.invoke({ command: 'plugin:clipboard-manager|read_text', payload: {} })
      return r == null ? '' : String(r)
    },
  }
}
