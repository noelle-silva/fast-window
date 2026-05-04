import { createAiChatDirectClient, type AiChatDirectClient } from './createAiChatDirectClient'
import { AI_CHAT_DIRECT_METHOD } from '../protocol/aiChatProtocol'

export type DirectCapabilitiesAdapter = {
  api: Record<string, any>
  directClient: AiChatDirectClient
}

export async function createDirectCapabilitiesAdapter(baseApi: unknown): Promise<DirectCapabilitiesAdapter> {
  const directClient = await createAiChatDirectClient(baseApi)
  const host = (baseApi as any)?.host

  const api = {
    __meta: { runtime: 'ui', pluginId: 'ai-chat' },

    storage: {
      get: async (key: string) => directClient.invoke(AI_CHAT_DIRECT_METHOD.storageGet, { key }),
      set: async (key: string, value: unknown) => directClient.invoke(AI_CHAT_DIRECT_METHOD.storageSet, { key, value }),
      remove: async (key: string) => directClient.invoke(AI_CHAT_DIRECT_METHOD.storageRemove, { key }),
    },

    runtimeStorage: {
      get: async (key: string) => directClient.invoke(AI_CHAT_DIRECT_METHOD.storageGet, { key: `runtime/${key}` }),
      set: async (key: string, value: unknown) => directClient.invoke(AI_CHAT_DIRECT_METHOD.storageSet, { key: `runtime/${key}`, value }),
      remove: async (key: string) => directClient.invoke(AI_CHAT_DIRECT_METHOD.storageRemove, { key: `runtime/${key}` }),
      listDir: async () => [],
      flush: async () => {},
    },

    net: {
      request: async (req: unknown) => {
        const r = req as any
        const assistantMid = `svc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`
        await directClient.invoke(AI_CHAT_DIRECT_METHOD.submitRawServiceRequest, {
          target: {
            kind: 'role',
            roleId: '__ai_service__',
            chatId: `svc:${r?.purpose || 'misc'}`,
            branchId: 'main',
            assistantMid,
            tag: 'service',
            service: r?.purpose || 'misc',
          },
          req,
          stream: false,
        })
        const result = await directClient.invoke(AI_CHAT_DIRECT_METHOD.waitServiceFinal, { assistantMid, timeoutMs: r?.timeoutMs || 140000 })
        return { status: 200, body: String(result || '') }
      },
      requestStream: undefined,
    },

    files: {
      pickImages: typeof (baseApi as any)?.files?.pickImages === 'function'
        ? (maxCount?: number) => (baseApi as any).files.pickImages(maxCount)
        : undefined,
      images: {
        read: async (req: unknown) => {
          const path = String((req as any)?.path || (req as any)?.relPath || '').trim()
          return directClient.invoke(AI_CHAT_DIRECT_METHOD.imageRead, { path })
        },
        writeBase64: async (req: unknown) =>
          directClient.invoke(AI_CHAT_DIRECT_METHOD.imageWrite, req),
        delete: async (req: unknown) =>
          directClient.invoke(AI_CHAT_DIRECT_METHOD.imageDelete, req),
      },
    },

    ui: {
      showToast: typeof (baseApi as any)?.ui?.showToast === 'function'
        ? (message: any) => (baseApi as any).ui.showToast(message)
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
      background: {
        endpoint: typeof (baseApi as any)?.background?.endpoint === 'function'
          ? () => (baseApi as any).background.endpoint()
          : undefined,
      },
    },
  }

  return { api, directClient }
}
