import { extractOpenAiDelta, sseFeed } from '../core/sse'
import { now } from '../core/utils'
import type { AiChatNetAdapter, AiChatRun, AiChatRuntimeStore } from './types'
import { createAiChatRunStore } from './store'
import { withRuntimeLock } from './lock'

export function createAiChatRunner(opts: {
  store: AiChatRuntimeStore
  net: AiChatNetAdapter
  owner: string
  heartbeatMs?: number
  idleTimeoutMs?: number
  noProgressTimeoutMs?: number
  onProgress?: (run: AiChatRun, text: string) => Promise<void> | void
  onFinal?: (run: AiChatRun, finalText: string) => Promise<void> | void
}) {
  const rt = opts.store
  const net = opts.net
  const owner = String(opts.owner || '').trim()
  if (!owner) throw new Error('owner 不能为空')
  const runs = createAiChatRunStore(rt)

  const HEARTBEAT_MS = Math.max(100, Math.min(1000, Math.floor(opts.heartbeatMs ?? 250)))
  const IDLE_MS = Math.max(5000, Math.min(10 * 60 * 1000, Math.floor(opts.idleTimeoutMs ?? 90_000)))
  const NO_PROGRESS_MS = Math.max(5000, Math.min(10 * 60 * 1000, Math.floor(opts.noProgressTimeoutMs ?? 120_000)))

  async function isCanceled(runId: string) {
    const r = await runs.getRun(runId)
    if (!r) return true
    if (r.status === 'canceled') return true
    if (typeof r.cancelRequestedAt === 'number' && r.cancelRequestedAt > 0) return true
    return false
  }

  async function finalize(run: AiChatRun, status: 'succeeded' | 'failed' | 'canceled', text: string, errMsg?: string) {
    const t = now()
    await runs.patchRun(run.id, {
      status,
      finishedAt: t,
      lastError: errMsg ? { message: String(errMsg) } : undefined,
    })
    try {
      if (opts.onFinal) await opts.onFinal({ ...(run as any), status } as any, text)
    } catch (_) {}
    try {
      await runs.removeProgress(run.id)
    } catch (_) {}
  }

  async function runOnce(runId: string) {
    const run = await runs.getRun(runId)
    if (!run) return
    if (run.status !== 'running') return
    if (String(run.owner || '') !== owner) return

    const startedAt = typeof run.startedAt === 'number' && run.startedAt > 0 ? run.startedAt : now()
    await runs.patchRun(runId, { startedAt })

    let out = ''
    let lastFlushAt = 0
    let lastEventAt = now()
    let lastProgressAt = lastEventAt

    const flush = async (force: boolean) => {
      const t = now()
      if (!force && t - lastFlushAt < 220) return
      lastFlushAt = t
      await runs.setProgress(runId, { text: out, updatedAt: t })
      try {
        if (opts.onProgress) await opts.onProgress(run, out)
      } catch (_) {}
    }

    try {
      if (await isCanceled(runId)) {
        await flush(true)
        await finalize(run, 'canceled', out || '（已停止）')
        return
      }

      if (run.stream && typeof net.requestStream === 'function') {
        const stream = await net.requestStream(run.req)
        const sse = { buf: '', done: false }

        let streamClosed = false
        const closeStream = async () => {
          if (streamClosed) return
          streamClosed = true
          try {
            await (stream as any)?.return?.()
          } catch (_) {}
          try {
            await (stream as any)?.cancel?.()
          } catch (_) {}
        }

        let nextP: Promise<any> = (stream as any)?.next?.()
        if (!nextP || typeof (nextP as any)?.then !== 'function') throw new Error('stream.next 不可用（无法消费流式响应）')

        while (true) {
          const raced: any = await Promise.race([
            Promise.resolve(nextP)
              .then((r) => ({ kind: 'next', r }))
              .catch((err) => ({ kind: 'err', err })),
            new Promise((r) => setTimeout(() => r({ kind: 'tick' }), HEARTBEAT_MS)),
          ])

          if (raced.kind === 'tick') {
            if (await isCanceled(runId)) {
              await closeStream()
              await flush(true)
              await finalize(run, 'canceled', out || '（已停止）')
              return
            }
            const t = now()
            if (t - lastEventAt > IDLE_MS) {
              await closeStream()
              throw new Error('流式连接长时间无响应（可能已卡住）')
            }
            if (t - lastProgressAt > NO_PROGRESS_MS) {
              await closeStream()
              throw new Error('流式输出长时间无进展（可能已卡住）')
            }
            continue
          }

          if (raced.kind === 'err') throw raced.err

          const it = raced.r
          if (it && it.done) break

          const ev = it?.value
          lastEventAt = now()

          if (await isCanceled(runId)) {
            await closeStream()
            await flush(true)
            await finalize(run, 'canceled', out || '（已停止）')
            return
          }

          const t = String(ev?.type || '')
          if (t === 'start') {
            lastProgressAt = now()
            nextP = (stream as any)?.next?.()
            continue
          }
          if (t === 'chunk') {
            const prevLen = out.length
            const text = String(ev?.text || '')
            if (!text) {
              nextP = (stream as any)?.next?.()
              continue
            }
            sseFeed(sse, text, (json) => {
              if (json?.error?.message) throw new Error(String(json.error.message))
              const delta = extractOpenAiDelta(json)
              if (typeof delta === 'string' && delta) out += delta
            })
            if (out.length !== prevLen || sse.done) lastProgressAt = now()
            await flush(false)
            if (sse.done) {
              await closeStream()
              break
            }
            nextP = (stream as any)?.next?.()
            continue
          }
          if (t === 'error') throw new Error(String(ev?.message || '请求失败'))
          if (t === 'end') break

          nextP = (stream as any)?.next?.()
        }
      } else {
        const r = await net.request(run.req)
        const bodyText = String(r?.body || '')
        if (run.stream) {
          const sse = { buf: '', done: false }
          sseFeed(sse, bodyText, (json) => {
            if (json?.error?.message) throw new Error(String(json.error.message))
            const delta = extractOpenAiDelta(json)
            if (typeof delta === 'string' && delta) out += delta
          })
        } else {
          const json = JSON.parse(bodyText || '{}')
          out = json?.choices?.[0]?.message?.content ?? json?.choices?.[0]?.text ?? json?.output_text ?? ''
          out = String(out || '')
        }
      }

      await flush(true)
      await finalize(run, 'succeeded', out)
    } catch (e: any) {
      const canceled = await isCanceled(runId)
      await flush(true).catch(() => {})
      if (canceled) await finalize(run, 'canceled', out || '（已停止）')
      else {
        const msg = String(e?.message || e || '请求失败')
        await finalize(run, 'failed', out || `（请求失败：${msg}）`, msg)
      }
    }
  }

  async function runWithScopeLock(runId: string) {
    const run = await runs.getRun(runId)
    if (!run) return
    if (run.status !== 'running') return
    if (String(run.owner || '') !== owner) return

    await withRuntimeLock({
      store: rt,
      lockKey: String(run.scopeLockKey || ''),
      owner,
      ttlMs: 2500,
      deadlineMs: 8000,
      fn: async () => runOnce(runId),
    })
  }

  return { runWithScopeLock }
}
