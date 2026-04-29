import { createAiChatStorage } from '../storage/legacyPluginFileStorageAdapter'
import { createToast } from '../host/toast'
import { createClipboardApi } from '../host/clipboard'
import { createWindowApi } from '../host/window'
import { createNetApi } from '../host/net'
import { createImageFilesApi } from '../host/imageFiles'

export function createAiChatFastWindowApi(baseApi: any, pluginId: string) {
  const base = baseApi || {}
  const tauri = base?.tauri || null
  if (!tauri || typeof tauri.invoke !== 'function') {
    throw new Error('tauri.invoke 不可用（请更新宿主网关）')
  }

  const toast = createToast()
  const st = createAiChatStorage(tauri, pluginId)
  const clipboard = createClipboardApi(tauri)
  const windowApi = createWindowApi(tauri, toast)
  const net = createNetApi(tauri)
  const filesApi = createImageFilesApi(tauri, pluginId)

  const api = {
    ...base,
    tauri,

    ui: {
      ...(base.ui || {}),
      showToast: (message: any) => toast(message),
      startDragging: windowApi.startDragging,
    },

    clipboard: {
      ...(base.clipboard || {}),
      writeText: clipboard.writeText,
      writeImage: clipboard.writeImage,
      readText: clipboard.readText,
    },

    storage: {
      ...(st.storage as any),
    },

    runtimeStorage: {
      ...(st.runtimeStorage as any),
    },

    net: {
      request: net.request,
      requestStream: net.requestStream,
    },

    files: {
      ...(base.files || {}),
      pickImages: filesApi.pickImages,
      images: {
        ...((base.files && base.files.images) || {}),
        writeBase64: filesApi.images.writeBase64,
        read: filesApi.images.read,
        delete: filesApi.images.delete,
      },
    },
  }

  return api
}
