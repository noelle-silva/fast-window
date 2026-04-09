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
  maxRunMs?: number
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
  // 默认偏“快失败”：避免 UI 永远停在（生成中…）。
  const NO_PROGRESS_MS = Math.max(5000, Math.min(10 * 60 * 1000, Math.floor(opts.noProgressTimeoutMs ?? 25_000)))
  // 兜底：无论底层实现如何抖动/乱发事件，都必须“必然收尾”。
  const MAX_RUN_MS = Math.max(30_000, Math.min(60 * 60 * 1000, Math.floor(opts.maxRunMs ?? 15 * 60 * 1000)))

  function timeoutErr(label: string) {
    return new Error(`${label} timeout`)
  }

  async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    const t = Math.max(1, Math.floor(ms || 0))
    return await Promise.race([
      p,
      new Promise<T>((_resolve, reject) => setTimeout(() => reject(timeoutErr(label)), t)),
    ])
  }

  async function bestEffort(p: Promise<any>, ms: number, label: string) {
    try {
      await withTimeout(Promise.resolve(p), ms, label)
    } catch (_) {}
  }

  async function isCanceled(runId: string) {
    const r = await withTimeout(runs.getRun(runId), 1200, 'getRun').catch(() => null)
    if (!r) return true
    if (r.status === 'canceled') return true
    if (typeof r.cancelRequestedAt === 'number' && r.cancelRequestedAt > 0) return true
    return false
  }

  async function finalize(run: AiChatRun, status: 'succeeded' | 'failed' | 'canceled', text: string, errMsg?: string) {
    const t = now()
    // 引擎底线：任何 I/O 不允许把“收尾”卡死（否则 UI 会永久 pending）。
    await bestEffort(
      runs.patchRun(run.id, {
        status,
        finishedAt: t,
        lastError: errMsg ? { message: String(errMsg) } : undefined,
      }),
      1500,
      'patchRun'
    )

    if (opts.onFinal) {
      await bestEffort(opts.onFinal({ ...(run as any), status } as any, text) as any, 8000, 'onFinal')
    }
    // 运行时数据：收尾后就清理，避免后台 tick 每次都扫描一堆“已结束 run”。
    await bestEffort(runs.removeRun(run.id), 1500, 'removeRun')
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
    let firstDeltaAt = 0

    const flush = async (force: boolean) => {
      const t = now()
      if (!force && t - lastFlushAt < 220) return
      lastFlushAt = t
      await bestEffort(runs.setProgress(runId, { text: out, updatedAt: t }), 1200, 'setProgress')
      if (opts.onProgress) {
        await bestEffort(opts.onProgress(run, out) as any, 2000, 'onProgress')
      }
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
          const r = (stream as any)?.return?.()
          const c = (stream as any)?.cancel?.()
          if (r && typeof r?.then === 'function') await bestEffort(r, 800, 'stream.return')
          if (c && typeof c?.then === 'function') await bestEffort(c, 800, 'stream.cancel')
        }

        const handleJson = (json: any) => {
          if (json?.error?.message) throw new Error(String(json.error.message))
          const delta = extractOpenAiDelta(json)
          if (typeof delta === 'string' && delta) {
            out += delta
            const t = now()
            lastProgressAt = t
            if (!firstDeltaAt) firstDeltaAt = t
          }
        }

        const tryForceSseFlush = () => {
          if (sse.done) return true
          const buf = String((sse as any)?.buf || '')
          if (!buf) return false
          const prevLen = out.length
          // 一些服务会在最后一块 JSON 后缺少结尾的 \n\n，导致 sseFeed 永远解析不到 finish_reason。
          // 这里补一个分隔符，把尾巴冲出来，避免“快结束卡住不收尾”。
          sseFeed(sse, '\n\n', handleJson)
          if (sse.done && out.length === prevLen) lastProgressAt = now()
          return !!sse.done
        }

        const assertNotStuck = async (): Promise<boolean> => {
          const t = now()
          if (t - startedAt > MAX_RUN_MS) {
            await closeStream()
            throw new Error('生成超时（可能已卡住）')
          }
          if (t - lastEventAt > IDLE_MS) {
            await closeStream()
            throw new Error('流式连接长时间无响应（可能已卡住）')
          }

          // NO_PROGRESS：以“真正产出 delta”为准（不要把 start/心跳当作进展）。
          // 若尚未产出任何 delta，则放宽一些，避免模型长思考被误杀。
          const budget = firstDeltaAt ? NO_PROGRESS_MS : Math.max(NO_PROGRESS_MS, 90_000)
          if (t - lastProgressAt > budget) {
            if (tryForceSseFlush()) return true
            await closeStream()
            throw new Error('流式输出长时间无进展（可能已卡住）')
          }
          return false
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
            if (await assertNotStuck()) {
              await closeStream()
              break
            }
            continue
          }

          if (raced.kind === 'err') throw raced.err

          const it = raced.r
          if (it && it.done) {
            tryForceSseFlush()
            await closeStream()
            break
          }

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
            nextP = (stream as any)?.next?.()
            if (await assertNotStuck()) {
              await closeStream()
              break
            }
            continue
          }
          if (t === 'chunk') {
            const prevLen = out.length
            const text = String(ev?.text || '')
            if (!text) {
              nextP = (stream as any)?.next?.()
              if (await assertNotStuck()) {
                await closeStream()
                break
              }
              continue
            }
            sseFeed(sse, text, handleJson)
            if ((out.length !== prevLen && !firstDeltaAt) || sse.done) {
              const tt = now()
              lastProgressAt = tt
              if (!firstDeltaAt && out.length) firstDeltaAt = tt
            }
            await flush(false)
            if (sse.done) {
              await closeStream()
              break
            }
            nextP = (stream as any)?.next?.()
            if (await assertNotStuck()) {
              await closeStream()
              break
            }
            continue
          }
          if (t === 'error') throw new Error(String(ev?.message || '请求失败'))
          if (t === 'end') {
            tryForceSseFlush()
            await closeStream()
            break
          }

          nextP = (stream as any)?.next?.()
          if (await assertNotStuck()) {
            await closeStream()
            break
          }
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

    const lockKey = String(run.scopeLockKey || '').trim()
    if (!lockKey) throw new Error('scopeLockKey 不能为空')

    // scope lock：互斥域的唯一硬约束，必须覆盖整个 run 生命周期（续租 keepAlive）。
    // owner 必须带 runId，避免同一后台实例内多任务互相误释放。
    try {
      await withRuntimeLock({
        store: rt,
        lockKey,
        owner: `scope:${owner}:${runId}`,
        ttlMs: 12_000,
        deadlineMs: 30_000,
        keepAlive: true,
        keepAliveEveryMs: 4_000,
        fn: async () => runOnce(runId),
      })
    } catch (e: any) {
      // 无法获取互斥锁时，不能吞掉，否则会留下永远 pending 的消息。
      const msg = String(e?.message || e || 'scope lock failed')
      let text = '（请求失败：锁获取超时）'
      try {
        const p = await runs.getProgress(runId)
        const s = String(p?.text || '').trim()
        if (s) text = s
      } catch (_) {}
      await finalize(run, 'failed', text, msg).catch(() => {})
    }
  }

  return { runWithScopeLock }
}
