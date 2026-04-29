import type { AiChatCapabilities, AiChatUiCapabilities } from '../gateway/capabilities'

export function createUiHostCapabilities(full: AiChatCapabilities): AiChatUiCapabilities {
  return {
    meta: { pluginId: full.meta.pluginId, runtime: 'ui' as const },
    storage: full.storage,
    ui: full.ui,
    clipboard: full.clipboard,
    files: {
      pickImages: full.files.pickImages,
      images: { read: full.files.images.read },
    },
    host: {
      back: typeof full.host?.back === 'function' ? () => full.host.back() : undefined,
    },
    background: {
      endpoint: () => {
        if (typeof full.host?.background?.endpoint === 'function') return full.host.background.endpoint()
        throw new Error('background.endpoint is not available')
      },
      connect: typeof full.host?.background?.connect === 'function' ? () => full.host.background.connect() : undefined,
    },
  }
}
