import { requireTauri } from './hostGateway'
import type { ClipboardGateway } from './types'

export function createClipboardGateway(baseApi: any): ClipboardGateway {
  const tauri = requireTauri(baseApi || {})
  return {
    async writeText(text: string) {
      const s = String(text ?? '')
      await tauri.invoke({ command: 'plugin:clipboard-manager|write_text', payload: { text: s } })
    },
  }
}
