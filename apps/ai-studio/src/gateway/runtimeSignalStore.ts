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

export async function getRunSignalForAssistant(store: AiChatRuntimeStore, assistantMid: string) {
  try {
    const value = await store.get(assistantMidRunKey(assistantMid))
    const signal = value && typeof value === 'object' ? (value as any) : null
    if (!signal) return null
    const runId = String(signal.runId || '').trim()
    if (!runId) return null
    return {
      runId,
      generationId: String(signal.generationId || '').trim(),
      createdAt: Number(signal.createdAt || 0) || 0,
    }
  } catch (_) {
    return null
  }
}

export async function isCurrentRunForAssistant(store: AiChatRuntimeStore, assistantMid: string, runId: string) {
  const expectedRunId = String(runId || '').trim()
  if (!expectedRunId) return false
  try {
    const value = await store.get(assistantMidRunKey(assistantMid))
    return String(value?.runId || '').trim() === expectedRunId
  } catch (_) {
    return false
  }
}

export async function setRunIdForAssistant(store: AiChatRuntimeStore, assistantMid: string, runId: string, generationId?: string) {
  try {
    await store.set(assistantMidRunKey(assistantMid), {
      runId: String(runId || '').trim(),
      generationId: String(generationId || '').trim() || undefined,
      createdAt: now(),
    })
  } catch (_) {}
}

export async function clearRunIdForAssistant(store: AiChatRuntimeStore, assistantMid: string, runId?: string) {
  try {
    const expectedRunId = String(runId || '').trim()
    if (expectedRunId) {
      const cur = await store.get(assistantMidRunKey(assistantMid))
      const curRunId = String(cur?.runId || '').trim()
      if (curRunId && curRunId !== expectedRunId) return
    }
    await store.remove(assistantMidRunKey(assistantMid))
  } catch (_) {}
}
