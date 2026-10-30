import { createAiChatDirectClient, type AiChatDirectClient } from './createAiChatDirectClient'
import { AI_CHAT_DIRECT_METHOD } from '../protocol/aiChatProtocol'
import { EUCLI_STUDIO_APP_ID } from '../runtime/eucliStudioGlobals'
import { createSessionSwitchClient, storageGetMany } from './sessionSwitchClient'
import { readHealthCheckFeatures } from './sessionSwitchClient'

export type DirectCapabilitiesAdapter = {
  api: Record<string, any>
  directClient: AiChatDirectClient
  sessionSwitch: ReturnType<typeof createSessionSwitchClient>
  // 重新握手并刷新能力协商。studio.bootstrap 之后必须调用一次：
  // box 能力由 bootstrap 触发探测，首次 healthCheck 拿不到。
  refreshCapabilities: () => Promise<void>
}

export async function createDirectCapabilitiesAdapter(baseApi: unknown): Promise<DirectCapabilitiesAdapter> {
  const directClient = await createAiChatDirectClient(baseApi)
  const host = (baseApi as any)?.host
  // 能力协商：healthCheck.features 决定走新接口还是旧 storage key，不靠协议版本。
  //
  // features 用「动态读取」而不是构造时快照：bootstrap 之后 box 能力才探测完成，
  // 快照模式会让所有 gated 功能永远关闭（且不会自动重读）。
  const sessionSwitch = createSessionSwitchClient({
    directClient,
    featuresSource: () => readHealthCheckFeatures(directClient.getHealthCheck()),
  })

  async function refreshCapabilities() {
    await directClient.refreshHealthCheck()
  }

  const api = {
    __meta: { runtime: 'ui', appId: EUCLI_STUDIO_APP_ID },
    // scope 化协议客户端：controller 据此决定走新接口还是旧 storage key。
    sessionSwitch,

    storage: {
      get: async (key: string) => directClient.invoke(AI_CHAT_DIRECT_METHOD.storageGet, { key }),
      set: async (key: string, value: unknown) => directClient.invoke(AI_CHAT_DIRECT_METHOD.storageSet, { key, value }),
      remove: async (key: string) => directClient.invoke(AI_CHAT_DIRECT_METHOD.storageRemove, { key }),
      // 迁移垫片：把 4 个 index key 的扇出压成一次往返。
      getMany: (keys: string[]) => storageGetMany(directClient, keys),
    },

    runtimeStorage: {
      get: async (key: string) => directClient.invoke(AI_CHAT_DIRECT_METHOD.storageGet, { key: `runtime/${key}` }),
      set: async (key: string, value: unknown) => directClient.invoke(AI_CHAT_DIRECT_METHOD.storageSet, { key: `runtime/${key}`, value }),
      remove: async (key: string) => directClient.invoke(AI_CHAT_DIRECT_METHOD.storageRemove, { key: `runtime/${key}` }),
      listDir: async () => [],
      flush: async () => {},
    },

    net: {
      // 超时预算由 direct client 按方法类统一签发（读 20s / 写与命令 45s）。
      // 这里绝不另加「最少 30s」这类补偿：那会把交互预算顶到后台预算之上。
      request: async (req: unknown) => directClient.invoke(AI_CHAT_DIRECT_METHOD.netRequest, req),
      requestStream: undefined,
    },

    files: {
      pickImages: typeof (baseApi as any)?.files?.pickImages === 'function'
        ? (maxCount?: number) => (baseApi as any).files.pickImages(maxCount)
        : undefined,
      pickArchiveFile: typeof (baseApi as any)?.files?.pickArchiveFile === 'function'
        ? () => (baseApi as any).files.pickArchiveFile()
        : undefined,
      pickArchiveFolder: typeof (baseApi as any)?.files?.pickArchiveFolder === 'function'
        ? () => (baseApi as any).files.pickArchiveFolder()
        : undefined,
      images: {
        read: async (req: unknown) => {
          const path = String((req as any)?.path || (req as any)?.relPath || '').trim()
          return directClient.invoke(AI_CHAT_DIRECT_METHOD.imageRead, { path })
        },
        writeBase64: async (req: unknown) => {
          const result = await directClient.invoke(AI_CHAT_DIRECT_METHOD.imageWrite, req)
          if (typeof result === 'string') return result
          const relPath = String((result as any)?.relPath || (result as any)?.path || '').trim()
          return relPath || result
        },
        delete: async (req: unknown) =>
          directClient.invoke(AI_CHAT_DIRECT_METHOD.imageDelete, req),
      },
    },

    artifacts: {
      import: async (req: { kind: string; filePath: string }) => directClient.invoke('artifacts.import', req),
    },

    ui: {
      showToast: typeof (baseApi as any)?.ui?.showToast === 'function'
        ? (message: any, options?: any) => (baseApi as any).ui.showToast(message, options)
        : undefined,
      startDragging: typeof (baseApi as any)?.ui?.startDragging === 'function'
        ? () => (baseApi as any).ui.startDragging()
        : undefined,
    },

    clipboard: {
      writeText: typeof (baseApi as any)?.clipboard?.writeText === 'function'
        ? (text: any) => (baseApi as any).clipboard.writeText(text)
        : undefined,
      writeImage: typeof (baseApi as any)?.clipboard?.writeImage === 'function'
        ? (dataUrl: any) => (baseApi as any).clipboard.writeImage(dataUrl)
        : undefined,
      readText: typeof (baseApi as any)?.clipboard?.readText === 'function'
        ? () => (baseApi as any).clipboard.readText()
        : undefined,
    },

    host: {
      ...(host || {}),
      directEvents: {
        subscribe: directClient.subscribe,
        onReconnected: directClient.onReconnected,
      },
      background: {
        endpoint: typeof (baseApi as any)?.background?.endpoint === 'function'
          ? () => (baseApi as any).background.endpoint()
          : undefined,
      },
    },
  }

  return { api, directClient, sessionSwitch, refreshCapabilities }
}
