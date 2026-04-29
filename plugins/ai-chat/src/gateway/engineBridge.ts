import { now } from '../core/utils'
import { createAiChatEngine } from '../engine'
import type { AiChatNetAdapter, AiChatRun, AiChatRuntimeStore } from '../engine'
import { assistantFinalKey, assistantStreamKey } from '../runtime/runtimeKeys'
import { clearRunIdForAssistant, getRunIdForAssistant, setRunIdForAssistant } from './runtimeSignalStore'

export function createAiChatEngineBridge(opts: {
  runtime: 'ui' | 'background'
  store: AiChatRuntimeStore
  net: AiChatNetAdapter
  streamKey?: (assistantMid: string) => string
  finalKey?: (assistantMid: string) => string
  onRunFinal: (run: AiChatRun, finalText: string) => Promise<void> | void
  onProgressEvent?: (run: AiChatRun, text: string) => Promise<void> | void
  onFinalEvent?: (run: AiChatRun, finalText: string) => Promise<void> | void
}) {
  const store = opts.store
  const streamKey = opts.streamKey || assistantStreamKey
  const finalKey = opts.finalKey || assistantFinalKey

  const engine = createAiChatEngine({
    store,
    net: opts.net,
    onProgress: async (run: any, text: string) => {
      const mid = String(run?.target?.assistantMid || '').trim()
      if (!mid) return
      try {
        await store.set(streamKey(mid), { text: String(text || ''), updatedAt: now() })
      } catch (_) {}
      try {
        if (opts.onProgressEvent) await opts.onProgressEvent(run as any, String(text || ''))
      } catch (_) {}
    },
    onFinal: async (run: any, finalText: string) => {
      const mid = String(run?.target?.assistantMid || '').trim()
      if (mid) {
        try {
          await store.set(finalKey(mid), {
            status: String(run?.status || ''),
            text: String(finalText || ''),
            finishedAt: now(),
            expiresAt: now() + 10 * 60 * 1000,
          })
        } catch (_) {}
      }
      try {
        await opts.onRunFinal(run as any, String(finalText || ''))
      } catch (_) {}
      try {
        if (opts.onFinalEvent) await opts.onFinalEvent(run as any, String(finalText || ''))
      } catch (_) {}
      if (mid) {
        try {
          await store.remove(streamKey(mid))
        } catch (_) {}
        await clearRunIdForAssistant(store, mid)
      }
    },
  })

  async function enqueue(spec: { target: AiChatRun['target']; req: AiChatRun['req']; stream: boolean }) {
    const runId = await engine.enqueue(spec)
    const mid = String(spec?.target?.assistantMid || '').trim()
    if (mid) await setRunIdForAssistant(store, mid, runId)
    return runId
  }

  async function cancelAssistant(assistantMid: string) {
    const mid = String(assistantMid || '').trim()
    if (!mid) return
    const runId = await getRunIdForAssistant(store, mid)
    if (!runId) return
    await engine.cancel(runId)
  }

  async function startBackgroundLoop(intervalMs = 350) {
    if (opts.runtime !== 'background') return
    const tick = async () => {
      try {
        await engine.tick()
      } catch (_) {}
    }
    await tick()
    setInterval(() => {
      tick().catch(() => {})
    }, Math.max(100, Math.floor(intervalMs || 0)))
  }

  return { enqueue, cancelAssistant, startBackgroundLoop, engineOwner: engine.owner }
}
