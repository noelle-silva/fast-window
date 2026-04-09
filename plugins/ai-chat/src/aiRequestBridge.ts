import { now } from './core/utils'
import { createAiChatEngine } from './engine'
import type { AiChatNetAdapter, AiChatRun, AiChatRuntimeStore } from './engine'

const MID_RUN_PREFIX = 'engine.v1/mid-run/'
const FINAL_PREFIX = 'engine.v1/final/'

function midRunKey(mid: string) {
  const m = String(mid || '').trim()
  if (!m) throw new Error('assistantMid 不能为空')
  return `${MID_RUN_PREFIX}${m}`
}

function finalKey(mid: string) {
  const m = String(mid || '').trim()
  if (!m) throw new Error('assistantMid 不能为空')
  return `${FINAL_PREFIX}${m}`
}

async function getRunIdForMid(store: AiChatRuntimeStore, assistantMid: string) {
  try {
    const v = await store.get(midRunKey(assistantMid))
    return String(v?.runId || '').trim()
  } catch (_) {
    return ''
  }
}

async function setRunIdForMid(store: AiChatRuntimeStore, assistantMid: string, runId: string) {
  try {
    await store.set(midRunKey(assistantMid), { runId: String(runId || '').trim(), createdAt: now() })
  } catch (_) {}
}

async function clearRunIdForMid(store: AiChatRuntimeStore, assistantMid: string) {
  try {
    await store.remove(midRunKey(assistantMid))
  } catch (_) {}
}

export function createAiChatRequestBridge(opts: {
  runtime: 'ui' | 'background'
  store: AiChatRuntimeStore
  net: AiChatNetAdapter
  streamKey: (assistantMid: string) => string
  onRunFinal: (run: AiChatRun, finalText: string) => Promise<void> | void
}) {
  const store = opts.store
  const streamKey = opts.streamKey

  const engine = createAiChatEngine({
    store,
    net: opts.net,
    onProgress: async (run: any, text: string) => {
      const mid = String(run?.target?.assistantMid || '').trim()
      if (!mid) return
      try {
        await store.set(streamKey(mid), { text: String(text || ''), updatedAt: now() })
      } catch (_) {}
    },
    onFinal: async (run: any, finalText: string) => {
      const mid = String(run?.target?.assistantMid || '').trim()
      // 先写 final marker：哪怕后面的落盘失败/卡住，UI 也能据此结束 pending（避免“快结束卡死”）。
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
      if (mid) {
        try {
          await store.remove(streamKey(mid))
        } catch (_) {}
        await clearRunIdForMid(store, mid)
      }
    },
  })

  async function enqueue(spec: { target: AiChatRun['target']; req: AiChatRun['req']; stream: boolean }) {
    const runId = await engine.enqueue(spec)
    const mid = String(spec?.target?.assistantMid || '').trim()
    if (mid) await setRunIdForMid(store, mid, runId)
    return runId
  }

  async function requestCancelByAssistantMid(assistantMid: string) {
    const mid = String(assistantMid || '').trim()
    if (!mid) return
    const runId = await getRunIdForMid(store, mid)
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

  return { enqueue, requestCancelByAssistantMid, startBackgroundLoop, engineOwner: engine.owner }
}
