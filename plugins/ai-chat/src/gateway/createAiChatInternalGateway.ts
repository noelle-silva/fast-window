import { now } from '../core/utils'
import type { AiChatNetAdapter, AiChatRun, AiChatRuntimeStore } from '../engine'
import { createAiChatRequestPipeline } from '../requestPipeline'
import type { AiChatRunSpec } from '../requestPipeline'
import { assistantFinalKey, assistantStreamKey } from '../runtime/runtimeKeys'
import { createAiChatEngineBridge } from './engineBridge'
import type { AiChatInternalGateway, AiChatRawServiceRequestInput } from './types'

const sleepMs = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, Math.floor(ms || 0))))

export function createAiChatInternalGateway(opts: {
  runtime: 'ui' | 'background'
  store: AiChatRuntimeStore
  net: AiChatNetAdapter
  onRunFinal: (run: AiChatRun, finalText: string) => Promise<void> | void
  buildRoleReqFromStorage: (jobStub: any) => Promise<any>
  buildGroupReqFromStorage: (jobStub: any) => Promise<any>
}): AiChatInternalGateway {
  const store = opts.store
  const bridge = createAiChatEngineBridge({
    runtime: opts.runtime,
    store,
    net: opts.net,
    onRunFinal: opts.onRunFinal,
  })
  const pipeline = createAiChatRequestPipeline({
    store,
    streamKey: assistantStreamKey,
    finalKey: assistantFinalKey,
    bridge,
    buildRoleReqFromStorage: opts.buildRoleReqFromStorage,
    buildGroupReqFromStorage: opts.buildGroupReqFromStorage,
  })

  async function consumeAssistantFinal(assistantMid: string) {
    const mid = String(assistantMid || '').trim()
    if (!mid) return null
    let finalValue: any = null
    try {
      finalValue = await store.get(assistantFinalKey(mid))
    } catch (_) {
      finalValue = null
    }
    if (finalValue) {
      try {
        await store.remove(assistantFinalKey(mid))
      } catch (_) {}
    }
    return finalValue
  }

  return {
    startBackgroundWorker: (intervalMs?: number) => bridge.startBackgroundLoop(intervalMs),
    submitRoleChatCompletion: (input: AiChatRunSpec) => pipeline.enqueueOne(input),
    submitGroupChatCompletion: (input: AiChatRunSpec) => pipeline.enqueueOne(input),
    submitManyChatCompletions: (inputs: AiChatRunSpec[]) => pipeline.enqueueMany(inputs),
    submitRawServiceRequest: (input: AiChatRawServiceRequestInput) => pipeline.enqueueReq(input),
    waitServiceFinal: async (assistantMid: string, timeoutMs: number) => {
      const deadline = now() + Math.max(2000, Math.floor(timeoutMs || 0))
      while (now() < deadline) {
        const finalValue = await consumeAssistantFinal(assistantMid)
        if (finalValue && typeof finalValue === 'object') {
          const status = String(finalValue?.status || '').trim()
          const text = String(finalValue?.text || '')
          if (status && status !== 'succeeded') throw new Error(text || '请求失败')
          return text
        }
        await sleepMs(120)
      }
      throw new Error('AI 微服务请求超时（后台可能未启动或已卡住）')
    },
    cancelAssistant: (assistantMid: string) => bridge.cancelAssistant(assistantMid),
    resetAssistantRuntime: (assistantMid: string) => pipeline.resetAssistantRuntime(assistantMid),
    readAssistantStream: async (assistantMid: string) => {
      const mid = String(assistantMid || '').trim()
      if (!mid) return null
      try {
        return await store.get(assistantStreamKey(mid))
      } catch (_) {
        return null
      }
    },
    consumeAssistantFinal,
  }
}
