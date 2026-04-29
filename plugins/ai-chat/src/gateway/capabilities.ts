import type { AiChatNetAdapter, AiChatRuntimeStore } from '../engine'

// ---- gateway interface types ----

export type AiChatStorageGateway = {
  get: (key: string) => Promise<any>
  set: (key: string, value: any) => Promise<void>
  remove: (key: string) => Promise<void>
  getAll?: () => Promise<Record<string, any>>
}

export type AiChatRuntimeStorageGateway = AiChatRuntimeStore & {
  flush?: () => Promise<void>
}

export type AiChatImageFilesGateway = {
  writeBase64?: (req: any) => Promise<any>
  read?: (req: any) => Promise<any>
  delete?: (req: any) => Promise<any>
}

export type AiChatFilesGateway = {
  pickImages?: (maxCount?: number) => Promise<any[]>
  images: AiChatImageFilesGateway
}

export type AiChatUiGateway = {
  showToast?: (message: any) => void
  startDragging?: () => Promise<void>
}

export type AiChatClipboardGateway = {
  writeText?: (text: any) => Promise<void>
  writeImage?: (dataUrl: any) => Promise<void>
  readText?: () => Promise<string>
}

// ---- full capabilities (legacy compat) ----

export type AiChatCapabilities = {
  meta: {
    pluginId: string
    runtime: 'ui' | 'background'
  }
  storage: AiChatStorageGateway
  runtimeStorage: AiChatRuntimeStorageGateway
  net: AiChatNetAdapter
  files: AiChatFilesGateway
  ui: AiChatUiGateway
  clipboard: AiChatClipboardGateway
  host?: any
}

// ---- narrow capabilities (v4.5 target) ----

export type AiChatUiCapabilities = {
  meta: { pluginId: string; runtime: 'ui' }
  storage: AiChatStorageGateway
  ui: AiChatUiGateway
  clipboard: AiChatClipboardGateway
  files: { pickImages?: (maxCount?: number) => Promise<any[]>; images: { read?: (req: any) => Promise<any> } }
  host: { back?: () => Promise<void> }
  background: { endpoint: () => Promise<unknown>; connect?: () => Promise<unknown> }
}

export type AiChatBackendCapabilities = {
  meta: { pluginId: string; runtime: 'background' }
  storage: AiChatStorageGateway
  runtimeStorage: AiChatRuntimeStorageGateway
  net: AiChatNetAdapter
  files: { images: { writeBase64?: (req: any) => Promise<any>; read?: (req: any) => Promise<any>; delete?: (req: any) => Promise<any> } }
}

export type AssistantRenderCapabilities = {
  meta: { pluginId: string; runtime: 'ui' | 'background' }
  clipboard: AiChatClipboardGateway
  ui: AiChatUiGateway
  files: { images: { read?: (req: any) => Promise<any> } }
}

function requireObject(value: any, label: string) {
  if (!value || typeof value !== 'object') throw new Error(`${label} 不可用`)
  return value
}

function requireFunction<T extends (...args: any[]) => any>(value: any, label: string): T {
  if (typeof value !== 'function') throw new Error(`${label} 不可用`)
  return value as T
}

function optionalFunction<T extends (...args: any[]) => any>(value: any): T | undefined {
  return typeof value === 'function' ? (value as T) : undefined
}

export function createAiChatCapabilitiesFromHostApi(hostApi: any, pluginId: string): AiChatCapabilities {
  const api = requireObject(hostApi, 'host api')
  const storage = requireObject(api.storage, 'storage')
  const runtimeStorage =
    api.runtimeStorage && typeof api.runtimeStorage.get === 'function' ? api.runtimeStorage : storage
  const net = requireObject(api.net, 'net')
  const files = api.files && typeof api.files === 'object' ? api.files : {}
  const images = files.images && typeof files.images === 'object' ? files.images : {}
  const ui = api.ui && typeof api.ui === 'object' ? api.ui : {}
  const clipboard = api.clipboard && typeof api.clipboard === 'object' ? api.clipboard : {}
  const runtime = String(api?.__meta?.runtime || 'ui') === 'background' ? 'background' : 'ui'

  return {
    meta: {
      pluginId: String(pluginId || ''),
      runtime,
    },
    storage: {
      get: requireFunction(storage.get, 'storage.get'),
      set: requireFunction(storage.set, 'storage.set'),
      remove: requireFunction(storage.remove, 'storage.remove'),
      getAll: optionalFunction(storage.getAll),
    },
    runtimeStorage: {
      get: requireFunction(runtimeStorage.get, 'runtimeStorage.get'),
      set: requireFunction(runtimeStorage.set, 'runtimeStorage.set'),
      remove: requireFunction(runtimeStorage.remove, 'runtimeStorage.remove'),
      listDir: optionalFunction(runtimeStorage.listDir),
      flush: optionalFunction(runtimeStorage.flush),
    },
    net: {
      request: requireFunction(net.request, 'net.request'),
      requestStream: optionalFunction(net.requestStream),
    },
    files: {
      pickImages: optionalFunction(files.pickImages),
      images: {
        writeBase64: optionalFunction(images.writeBase64),
        read: optionalFunction(images.read),
        delete: optionalFunction(images.delete),
      },
    },
    ui: {
      showToast: optionalFunction(ui.showToast),
      startDragging: optionalFunction(ui.startDragging),
    },
    clipboard: {
      writeText: optionalFunction(clipboard.writeText),
      writeImage: optionalFunction(clipboard.writeImage),
      readText: optionalFunction(clipboard.readText),
    },
    host: api.host,
  }
}
