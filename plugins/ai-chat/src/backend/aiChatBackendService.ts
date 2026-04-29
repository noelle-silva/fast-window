import type { AiChatDirectEvent } from '../protocol/aiChatProtocol'
import { AI_CHAT_DIRECT_METHOD, AI_CHAT_DIRECT_EVENT } from '../protocol/aiChatProtocol'
import { AiChatDirectError } from '../protocol/aiChatProtocolGuards'
import { createAiChatInternalGateway } from '../gateway/createAiChatInternalGateway'
import type { AiChatCapabilities } from '../gateway/capabilities'
import type { AiChatRun } from '../engine'
import { buildOpenAiChatReqFromStorage, buildOpenAiGroupChatReqFromStorage, type RequestBuilderDeps } from './requestBuilders'

export type AiChatBackendService = {
  dispatch: (method: string, params: unknown) => Promise<unknown>
  dispose: () => Promise<void>
}

export function createAiChatBackendService(opts: {
  capabilities: AiChatCapabilities
  onEvent?: (event: AiChatDirectEvent) => void
}): AiChatBackendService {
  const cap = opts.capabilities
  const onEvent = opts.onEvent

  function emit(event: AiChatDirectEvent) {
    if (onEvent) {
      try { onEvent(event) } catch (_) {}
    }
  }

  const builderDeps: RequestBuilderDeps = {
    storage: { get: async (key) => cap.storage.get(key) },
    imageReader: typeof cap.files?.images?.read === 'function'
      ? { read: async (path: string) => cap.files.images.read!({ scope: 'data', path }) }
      : undefined,
  }

  const gateway = createAiChatInternalGateway({
    runtime: 'background',
    store: cap.runtimeStorage,
    net: cap.net,
    onRunFinal: async () => {},
    onProgressEvent: async (run: AiChatRun, text: string) => {
      const mid = String(run?.target?.assistantMid || '').trim()
      if (!mid) return
      emit({ type: 'event', name: AI_CHAT_DIRECT_EVENT.runProgress, payload: { assistantMid: mid, text } })
    },
    onFinalEvent: async (run: AiChatRun, finalText: string) => {
      const mid = String(run?.target?.assistantMid || '').trim()
      if (!mid) return
      emit({ type: 'event', name: AI_CHAT_DIRECT_EVENT.runFinal, payload: { assistantMid: mid, text: finalText, status: String(run?.status || '') } })
    },
    buildRoleReqFromStorage: (jobStub) => buildOpenAiChatReqFromStorage(builderDeps, jobStub),
    buildGroupReqFromStorage: (jobStub) => buildOpenAiGroupChatReqFromStorage(builderDeps, jobStub),
  })

  gateway.startBackgroundWorker(350).catch(() => {})

  async function dispatch(method: string, params: unknown): Promise<unknown> {
    const p = (params && typeof params === 'object' ? params : {}) as Record<string, unknown>

    switch (method) {
      case AI_CHAT_DIRECT_METHOD.healthCheck:
        return { version: 1, status: 'ok' }

      case AI_CHAT_DIRECT_METHOD.submitChatCompletion: {
        await gateway.submitRoleChatCompletion(p as any)
        return {}
      }
      case AI_CHAT_DIRECT_METHOD.submitManyChatCompletions: {
        const list = Array.isArray(p?.inputs) ? p.inputs : (Array.isArray(p) ? p : [p])
        await gateway.submitManyChatCompletions(list as any)
        return {}
      }
      case AI_CHAT_DIRECT_METHOD.submitRawServiceRequest: {
        await gateway.submitRawServiceRequest(p as any)
        return {}
      }

      case AI_CHAT_DIRECT_METHOD.cancelAssistant: {
        const mid = String(p?.assistantMid || '').trim()
        if (!mid) throw new AiChatDirectError('BAD_REQUEST', 'assistantMid is required')
        await gateway.cancelAssistant(mid)
        return {}
      }
      case AI_CHAT_DIRECT_METHOD.readAssistantStream: {
        const mid = String(p?.assistantMid || '').trim()
        if (!mid) throw new AiChatDirectError('BAD_REQUEST', 'assistantMid is required')
        return await gateway.readAssistantStream(mid)
      }
      case AI_CHAT_DIRECT_METHOD.consumeAssistantFinal: {
        const mid = String(p?.assistantMid || '').trim()
        if (!mid) throw new AiChatDirectError('BAD_REQUEST', 'assistantMid is required')
        return await gateway.consumeAssistantFinal(mid)
      }
      case AI_CHAT_DIRECT_METHOD.resetAssistantRuntime: {
        const mid = String(p?.assistantMid || '').trim()
        if (!mid) throw new AiChatDirectError('BAD_REQUEST', 'assistantMid is required')
        await gateway.resetAssistantRuntime(mid)
        return {}
      }
      case AI_CHAT_DIRECT_METHOD.waitServiceFinal: {
        const mid = String(p?.assistantMid || '').trim()
        const timeoutMs = Number(p?.timeoutMs || 0)
        if (!mid) throw new AiChatDirectError('BAD_REQUEST', 'assistantMid is required')
        return await gateway.waitServiceFinal(mid, timeoutMs || 140_000)
      }

      case AI_CHAT_DIRECT_METHOD.storageGet: {
        const key = String(p?.key || '').trim()
        if (!key) throw new AiChatDirectError('BAD_REQUEST', 'key is required')
        return await cap.storage.get(key)
      }
      case AI_CHAT_DIRECT_METHOD.storageSet: {
        const key = String(p?.key || '').trim()
        if (!key) throw new AiChatDirectError('BAD_REQUEST', 'key is required')
        await cap.storage.set(key, p?.value)
        return {}
      }
      case AI_CHAT_DIRECT_METHOD.storageRemove: {
        const key = String(p?.key || '').trim()
        if (!key) throw new AiChatDirectError('BAD_REQUEST', 'key is required')
        await cap.storage.remove(key)
        return {}
      }

      case AI_CHAT_DIRECT_METHOD.imageRead: {
        const path = String(p?.path || '').trim()
        if (!path) throw new AiChatDirectError('BAD_REQUEST', 'path is required')
        return await cap.files.images.read!({ scope: 'data', path })
      }
      case AI_CHAT_DIRECT_METHOD.imageWrite: {
        if (typeof cap.files?.images?.writeBase64 !== 'function') throw new AiChatDirectError('NOT_IMPLEMENTED', 'imageWrite not available')
        return await cap.files.images.writeBase64(p)
      }
      case AI_CHAT_DIRECT_METHOD.imageDelete: {
        if (typeof cap.files?.images?.delete !== 'function') throw new AiChatDirectError('NOT_IMPLEMENTED', 'imageDelete not available')
        await cap.files.images.delete(p)
        return {}
      }
      case AI_CHAT_DIRECT_METHOD.imagePick:
        throw new AiChatDirectError('NOT_IMPLEMENTED', 'imagePick must be handled by UI host capability')

      default:
        throw new AiChatDirectError('METHOD_NOT_FOUND', `未知方法: ${method}`)
    }
  }

  return { dispatch, async dispose() {} }
}
