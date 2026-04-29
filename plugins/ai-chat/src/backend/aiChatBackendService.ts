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
    storage: {
      get: async (key) => cap.storage.get(key),
    },
    imageReader: typeof cap.files?.images?.read === 'function'
      ? { read: async (path: string) => cap.files.images.read!({ scope: 'data', path }) }
      : undefined,
  }

  const gateway = createAiChatInternalGateway({
    runtime: 'background',
    store: cap.runtimeStorage,
    net: cap.net,
    onRunFinal: async (_run: AiChatRun, _finalText: string) => {},
    onProgressEvent: async (run: AiChatRun, text: string) => {
      const mid = String(run?.target?.assistantMid || '').trim()
      if (!mid) return
      emit({ type: 'event', name: AI_CHAT_DIRECT_EVENT.runProgress, payload: { assistantMid: mid, text } })
    },
    onFinalEvent: async (run: AiChatRun, finalText: string) => {
      const mid = String(run?.target?.assistantMid || '').trim()
      if (!mid) return
      emit({
        type: 'event',
        name: AI_CHAT_DIRECT_EVENT.runFinal,
        payload: { assistantMid: mid, text: finalText, status: String(run?.status || '') },
      })
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
        const assistantMid = String(p?.assistantMid || '').trim()
        if (!assistantMid) throw new AiChatDirectError('BAD_REQUEST', 'assistantMid is required')
        await gateway.cancelAssistant(assistantMid)
        return {}
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

  const gateway = createAiChatInternalGateway({
    runtime: 'background',
    store: cap.runtimeStorage,
    net: cap.net,
    onRunFinal: async (_run: AiChatRun, _finalText: string) => {
      // controller 侧的 onRunFinal 逻辑（patchAssistantMessage 等）属于 UI 层
      // 在 v4.5 架构下由 UI 自己处理，这里只负责推送事件
    },
    onProgressEvent: async (run: AiChatRun, text: string) => {
      const mid = String(run?.target?.assistantMid || '').trim()
      if (!mid) return
      emit({ type: 'event', name: AI_CHAT_DIRECT_EVENT.runProgress, payload: { assistantMid: mid, text } })
    },
    onFinalEvent: async (run: AiChatRun, finalText: string) => {
      const mid = String(run?.target?.assistantMid || '').trim()
      if (!mid) return
      emit({
        type: 'event',
        name: AI_CHAT_DIRECT_EVENT.runFinal,
        payload: { assistantMid: mid, text: finalText, status: String(run?.status || '') },
      })
    },
    // --- 阶段五从 controller 提取 builder 后替换为真实现 ---
    buildRoleReqFromStorage: async () => {
      throw new AiChatDirectError('NOT_IMPLEMENTED', 'submitChatCompletion will be available in phase 5')
    },
    buildGroupReqFromStorage: async () => {
      throw new AiChatDirectError('NOT_IMPLEMENTED', 'submitGroupChatCompletion will be available in phase 5')
    },
  })

  gateway.startBackgroundWorker(350).catch(() => {})

  async function dispatch(method: string, params: unknown): Promise<unknown> {
    const p = (params && typeof params === 'object' ? params : {}) as Record<string, unknown>

    switch (method) {
      case AI_CHAT_DIRECT_METHOD.healthCheck:
        return { version: 1, status: 'ok' }

      case AI_CHAT_DIRECT_METHOD.cancelAssistant: {
        const assistantMid = String(p?.assistantMid || '').trim()
        if (!assistantMid) throw new AiChatDirectError('BAD_REQUEST', 'assistantMid is required')
        await gateway.cancelAssistant(assistantMid)
        return {}
      }

      case AI_CHAT_DIRECT_METHOD.readAssistantStream: {
        const assistantMid = String(p?.assistantMid || '').trim()
        if (!assistantMid) throw new AiChatDirectError('BAD_REQUEST', 'assistantMid is required')
        return await gateway.readAssistantStream(assistantMid)
      }

      case AI_CHAT_DIRECT_METHOD.consumeAssistantFinal: {
        const assistantMid = String(p?.assistantMid || '').trim()
        if (!assistantMid) throw new AiChatDirectError('BAD_REQUEST', 'assistantMid is required')
        return await gateway.consumeAssistantFinal(assistantMid)
      }

      case AI_CHAT_DIRECT_METHOD.resetAssistantRuntime: {
        const assistantMid = String(p?.assistantMid || '').trim()
        if (!assistantMid) throw new AiChatDirectError('BAD_REQUEST', 'assistantMid is required')
        await gateway.resetAssistantRuntime(assistantMid)
        return {}
      }

      case AI_CHAT_DIRECT_METHOD.waitServiceFinal: {
        const assistantMid = String(p?.assistantMid || '').trim()
        const timeoutMs = Number(p?.timeoutMs || 0)
        if (!assistantMid) throw new AiChatDirectError('BAD_REQUEST', 'assistantMid is required')
        return await gateway.waitServiceFinal(assistantMid, timeoutMs || 140_000)
      }

      default:
        throw new AiChatDirectError('METHOD_NOT_FOUND', `未知方法: ${method}`)
    }
  }

  async function dispose() {
    // cleanup if needed
  }

  return { dispatch, dispose }
}
