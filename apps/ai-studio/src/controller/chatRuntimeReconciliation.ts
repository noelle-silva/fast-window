import { now } from '../core/utils'
import { finishAssistantRun, isAssistantRunSignalCurrent, normalizeAssistantRunSignal, ASSISTANT_RUNNING_CONTENT } from '../domain/assistantRunState'
import { listActiveAssistantMessages } from '../domain/chatRunState'
import type { AiChatInternalGateway } from '../gateway/types'

export function createChatRuntimeReconciliation(deps: {
  aiGateway: Pick<AiChatInternalGateway, 'consumeAssistantFinal' | 'getAssistantRuntime' | 'readAssistantStream' | 'resetAssistantRuntime'>
  uiStreamCache: Map<string, any>
}) {
  const { aiGateway, uiStreamCache } = deps

  async function readCurrentText(message: any, mid: string) {
    try {
      const streamSignal = normalizeAssistantRunSignal(await aiGateway.readAssistantStream(mid))
      if (streamSignal && isAssistantRunSignalCurrent(message, streamSignal) && streamSignal.text) return streamSignal.text
    } catch (_) {}

    try {
      const cached = normalizeAssistantRunSignal(uiStreamCache.get(mid))
      if (cached && isAssistantRunSignalCurrent(message, cached) && cached.text) return cached.text
    } catch (_) {}

    const current = String(message?.content || '').trim()
    if (current && current !== ASSISTANT_RUNNING_CONTENT) return current
    return ''
  }

  async function reconcileChatRuns(chat: any) {
    const refs = listActiveAssistantMessages(chat)
    if (!refs.length) return false

    let changed = false
    for (const ref of refs) {
      const { message, mid, generationId } = ref
      const finalSignal = normalizeAssistantRunSignal(await aiGateway.consumeAssistantFinal(mid).catch(() => null))
      if (finalSignal && isAssistantRunSignalCurrent(message, finalSignal)) {
        const status = finalSignal.status === 'failed' || finalSignal.status === 'canceled' ? finalSignal.status : 'succeeded'
        finishAssistantRun(message, finalSignal.text || String(message?.content || ''), status, finalSignal.finishedAt || now())
        uiStreamCache.delete(mid)
        await aiGateway.resetAssistantRuntime(mid).catch(() => undefined)
        changed = true
        continue
      }

      let runtime: Awaited<ReturnType<typeof aiGateway.getAssistantRuntime>> = null
      try {
        runtime = await aiGateway.getAssistantRuntime(mid)
      } catch (_) {
        continue
      }
      const runtimeGenerationId = String(runtime?.generationId || '').trim()
      if (runtime?.active && generationId && runtimeGenerationId === generationId) continue

      const text = await readCurrentText(message, mid)
      finishAssistantRun(message, text || '（已停止）', 'canceled', now())
      uiStreamCache.delete(mid)
      await aiGateway.resetAssistantRuntime(mid).catch(() => undefined)
      changed = true
    }

    if (changed && chat && typeof chat === 'object') chat.updatedAt = now()
    return changed
  }

  return { reconcileChatRuns }
}
