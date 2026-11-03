import { messageHtmlCache, type MessageCache } from '../render/messageCache'
import { startRenderPrewarm, type RenderPrewarmRun } from '../render/prewarm'
import type { RenderSafetyPolicy } from '../render/types'
import { createRenderWorkerPool, submitParseBatch } from '../render/worker/renderPool'
import type { WorkerPool } from '../render/worker/pool'

// ============================================================================
// 渲染缓存预计算的控制器侧装配
//
// 线程池与消毒器都由 controller 注入：预计算模块自身不创建 Worker、不碰
// 全局设置，只接收「消息窗口 + 当前渲染条件」。线程池懒创建，首次打开
// 会话才付启动成本；controller 释放时连同在途任务一起收束。
// ============================================================================

export type RenderPrewarmRequest = {
  sessionKey?: unknown
  messages?: unknown
}

export type RenderPrewarmHandle = {
  cancel: () => void
}

const NOOP_HANDLE: RenderPrewarmHandle = { cancel: () => {} }

export type RenderPrewarmService = {
  prewarm: (request: RenderPrewarmRequest) => RenderPrewarmHandle
  dispose: () => void
}

export function createRenderPrewarmService(deps: {
  sanitizeHtml: (html: unknown, policy?: RenderSafetyPolicy) => string
  getPolicy: () => RenderSafetyPolicy
  getStickerSettings: () => {
    enabled: boolean
    getStickerPath: ((category: string, name: string) => string) | null
  }
  cache?: MessageCache
}): RenderPrewarmService {
  const cache = deps.cache ?? messageHtmlCache
  let pool: WorkerPool | null = null
  let active: RenderPrewarmRun | null = null

  function ensurePool(): WorkerPool | null {
    if (pool) return pool
    try {
      pool = createRenderWorkerPool()
      return pool
    } catch (_) {
      return null
    }
  }

  function cancelActive(): void {
    const run = active
    active = null
    run?.cancel()
  }

  function prewarm(request: RenderPrewarmRequest): RenderPrewarmHandle {
    // 同一时刻只保留一轮预计算：会话切换时旧一轮必须立即停写。
    cancelActive()

    const sessionKey = String(request?.sessionKey || '').trim()
    const messages = Array.isArray(request?.messages) ? (request.messages as readonly any[]) : []
    if (!sessionKey || !messages.length) return NOOP_HANDLE

    const workerPool = ensurePool()
    if (!workerPool) return NOOP_HANDLE

    // 渲染条件在启动时快照；中途设置变化时立即停止回填，避免产物按旧条件入缓存。
    const policy = deps.getPolicy()
    const stickers = deps.getStickerSettings()
    const run = startRenderPrewarm({
      messages,
      scope: sessionKey,
      policy,
      stickersEnabled: stickers.enabled,
      getStickerPath: stickers.getStickerPath,
      sanitizeHtml: deps.sanitizeHtml,
      submitBatch: (items, options) => submitParseBatch(workerPool, items, options),
      cache,
      isCurrent: () => deps.getPolicy() === policy && deps.getStickerSettings().enabled === stickers.enabled,
    })

    active = run
    void run.done.then(() => {
      if (active === run) active = null
    })

    return {
      cancel: () => {
        if (active === run) active = null
        run.cancel()
      },
    }
  }

  function dispose(): void {
    cancelActive()
    pool?.dispose()
    pool = null
  }

  return { prewarm, dispose }
}
