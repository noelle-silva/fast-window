import { now } from '../core/utils'
import type { AiChatRuntimeStore } from '../engine'
import { assistantMidRunKey } from '../runtime/runtimeKeys'

export async function getRunIdForAssistant(store: AiChatRuntimeStore, assistantMid: string) {
  try {
    const value = await store.get(assistantMidRunKey(assistantMid))
    return String(value?.runId || '').trim()
  } catch (_) {
    return ''
  }
}

export async function setRunIdForAssistant(store: AiChatRuntimeStore, assistantMid: string, runId: string) {
  try {
    await store.set(assistantMidRunKey(assistantMid), { runId: String(runId || '').trim(), createdAt: now() })
  } catch (_) {}
}

export async function clearRunIdForAssistant(store: AiChatRuntimeStore, assistantMid: string) {
  try {
    await store.remove(assistantMidRunKey(assistantMid))
  } catch (_) {}
}
