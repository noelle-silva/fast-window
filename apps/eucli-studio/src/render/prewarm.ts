import { isAssistantGenerating } from '../domain/assistantRunState'
import { messageVisibleText } from '../domain/chatMessageDisplay'
import {
  MESSAGE_BATCH_INITIAL_SIZE,
  MESSAGE_BATCH_SIZE,
  planMessageBatchMount,
} from '../domain/messageBatchMount'
import { runFrameBudgetTasks, type FrameBudgetOptions } from '../ui/scheduling/frameBudget'
import { messageHtmlCache, type MessageCache } from './messageCache'
import { assistantRenderCacheKey } from './renderCacheKey'
import { splitTopLevelBlocks } from './topLevelBlocks'
import type { RenderSafetyPolicy } from './types'
import { scanStickerTokens } from './unified/plugins/rehypeSticker'
import type { ParseWorkerOptions, RenderWorkerTask } from './worker/renderPool'
import type {
  WorkerItemResult,
  WorkerParseBatchItem,
  WorkerParseResult,
  WorkerStickerPathMap,
} from './worker/protocol'

// ============================================================================
// 打开会话时的消息缓存预计算
//
// 目标：消息真正挂到屏幕之前，把「当前窗口内尚未进缓存」的助手正文交给后台
// 线程批量算完；主线程只做消毒、切块、写入既有消息缓存。随后分批上屏时
// 同步引擎直接命中缓存，不再现场解析。
//
// 边界：
//   - 只有助手正文会进消息缓存（reasoning 不传 cacheScope，用户消息不走引擎）；
//   - 只处理调用方给的消息窗口，不预读全库、不碰懒加载与翻页；
//   - 后台失败 / 线程池背压 / 消毒失败一律安静跳过，等上屏时走同步渲染；
//   - 所有写入都按帧预算分片，且代际或会话身份变化后立即停写。
// ============================================================================

export const PREWARM_CHUNK_SIZE = 8
export const PREWARM_MAX_IN_FLIGHT = 2
export const PREWARM_WRITE_TASKS_PER_SLICE = 4

export type PrewarmBatchSubmit = (
  items: readonly WorkerParseBatchItem[],
  options?: ParseWorkerOptions,
) => RenderWorkerTask<WorkerItemResult<WorkerParseResult>[]>

export type PrewarmSanitizer = (html: unknown, policy?: RenderSafetyPolicy) => string

export type RenderPrewarmOptions = {
  messages: readonly any[]
  scope: string
  policy: RenderSafetyPolicy
  stickersEnabled: boolean
  getStickerPath?: ((category: string, name: string) => string) | null
  sanitizeHtml: PrewarmSanitizer
  submitBatch: PrewarmBatchSubmit
  cache?: MessageCache
  initialSize?: number
  batchSize?: number
  chunkSize?: number
  maxInFlight?: number
  // 分片调度是测试注入点；生产环境使用 frameBudget 的默认实现。
  frameBudget?: Omit<FrameBudgetOptions, 'maxTasksPerSlice'>
  // 会话切换等外部失效条件：返回 false 时立即停止，不再提交或写入。
  isCurrent?: () => boolean
}

export type RenderPrewarmResult = {
  requested: number
  written: number
  skipped: number
  cancelled: boolean
}

export type RenderPrewarmRun = {
  cancel: () => void
  done: Promise<RenderPrewarmResult>
}

type PrewarmEntry = {
  key: string
  source: string
}

function positiveInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.max(1, Math.floor(value))
    : fallback
}

// orderMessagesForMount 复刻分批上屏的揭示顺序：
// 先首屏尾部（马上可见），再按批次从新到旧，批次内部保持时间顺序。
// 预计算按这个顺序提交，缓存命中率最高。
function orderMessagesForMount(
  messages: readonly any[],
  initialSize: number,
  batchSize: number,
): any[] {
  const plan = planMessageBatchMount(messages as any[], { initialSize, batchSize })
  const tail: any[] = []
  for (let index = plan.anchorIndex; index < messages.length; index++) {
    tail.push(messages[index])
  }

  const byId = new Map<string, any>()
  for (const message of messages) {
    const id = String(message?.id || '').trim()
    if (id && !byId.has(id)) byId.set(id, message)
  }

  const history: any[] = []
  for (const batch of plan.batches) {
    for (const id of batch.ids) {
      const message = byId.get(id)
      if (message) history.push(message)
    }
  }

  return tail.concat(history)
}

function collectStickerPaths(
  sources: readonly string[],
  getStickerPath: (category: string, name: string) => string,
): WorkerStickerPathMap {
  const paths: WorkerStickerPathMap = {}
  for (const source of sources) {
    for (const token of scanStickerTokens(source)) {
      const key = `${token.category}/${token.name}`
      if (Object.prototype.hasOwnProperty.call(paths, key)) continue
      paths[key] = String(getStickerPath(token.category, token.name) || '')
    }
  }
  return paths
}

function buildEntries(options: {
  messages: readonly any[]
  scope: string
  policy: RenderSafetyPolicy
  stickersEnabled: boolean
  hasStickerPath: boolean
  cache: MessageCache
  initialSize: number
  batchSize: number
}): PrewarmEntry[] {
  const entries: PrewarmEntry[] = []
  const seen = new Set<string>()
  for (const message of orderMessagesForMount(options.messages, options.initialSize, options.batchSize)) {
    if (String(message?.role || '') !== 'assistant') continue
    if (isAssistantGenerating(message)) continue
    const source = messageVisibleText(message)
    if (!source.trim()) continue
    const key = assistantRenderCacheKey({
      source,
      policy: options.policy,
      stickersEnabled: options.stickersEnabled,
      hasStickerPath: options.hasStickerPath,
      scope: options.scope,
    })
    if (!key || seen.has(key)) continue
    // 已缓存（同会话同条件）的条目不再请求后台。
    if (options.cache.get(key)) continue
    seen.add(key)
    entries.push({ key, source })
  }
  return entries
}

function chunkEntries(entries: readonly PrewarmEntry[], chunkSize: number): PrewarmEntry[][] {
  const chunks: PrewarmEntry[][] = []
  for (let start = 0; start < entries.length; start += chunkSize) {
    chunks.push(entries.slice(start, start + chunkSize))
  }
  return chunks
}

export function startRenderPrewarm(options: RenderPrewarmOptions): RenderPrewarmRun {
  const cache = options.cache ?? messageHtmlCache
  const scope = String(options.scope || '').trim()
  const initialSize = positiveInt(options.initialSize, MESSAGE_BATCH_INITIAL_SIZE)
  const batchSize = positiveInt(options.batchSize, MESSAGE_BATCH_SIZE)
  const chunkSize = positiveInt(options.chunkSize, PREWARM_CHUNK_SIZE)
  const maxInFlight = positiveInt(options.maxInFlight, PREWARM_MAX_IN_FLIGHT)
  const initialEpoch = cache.epoch(scope)
  const hasStickerPath = typeof options.getStickerPath === 'function'

  const entries = scope
    ? buildEntries({
        messages: options.messages,
        scope,
        policy: options.policy,
        stickersEnabled: options.stickersEnabled,
        hasStickerPath,
        cache,
        initialSize,
        batchSize,
      })
    : []
  const chunks = chunkEntries(entries, chunkSize)

  const parseOptions: ParseWorkerOptions | undefined =
    options.stickersEnabled && options.getStickerPath
      ? {
          stickersEnabled: true,
          stickerPaths: collectStickerPaths(entries.map((entry) => entry.source), options.getStickerPath),
        }
      : undefined

  let cancelled = false
  let settled = false
  let stopSubmitting = false
  let nextChunk = 0
  let inFlight = 0
  let written = 0
  let skipped = 0

  const tasks = new Set<RenderWorkerTask<WorkerItemResult<WorkerParseResult>[]>>()
  const writeRuns = new Set<{ cancel: () => void }>()

  let resolveDone: (result: RenderPrewarmResult) => void = () => {}
  const done = new Promise<RenderPrewarmResult>((resolve) => {
    resolveDone = resolve
  })

  function isCurrent(): boolean {
    if (cancelled) return false
    if (cache.epoch(scope) !== initialEpoch) return false
    return options.isCurrent ? options.isCurrent() : true
  }

  function settle(): void {
    if (settled) return
    settled = true
    resolveDone({ requested: entries.length, written, skipped, cancelled })
  }

  function maybeFinish(): void {
    if (settled) return
    if (inFlight > 0) return
    if (!stopSubmitting && nextChunk < chunks.length) return
    settle()
  }

  function pump(): void {
    if (settled) return
    while (!cancelled && !stopSubmitting && inFlight < maxInFlight && nextChunk < chunks.length) {
      if (!isCurrent()) {
        stopSubmitting = true
        break
      }
      const chunk = chunks[nextChunk]
      nextChunk += 1
      submitChunk(chunk)
    }
    maybeFinish()
  }

  function submitChunk(chunk: readonly PrewarmEntry[]): void {
    const items: WorkerParseBatchItem[] = chunk.map((entry) => ({ key: entry.key, source: entry.source }))
    let task: RenderWorkerTask<WorkerItemResult<WorkerParseResult>[]>
    try {
      task = options.submitBatch(items, parseOptions)
    } catch (_) {
      // 线程池已释放或背压拒绝：安静放弃整轮，消息上屏时走同步渲染。
      skipped += chunk.length
      stopSubmitting = true
      return
    }

    inFlight += 1
    tasks.add(task)
    task.result.then(
      (items) => {
        if (settled) return
        tasks.delete(task)
        if (cancelled) return
        if (!isCurrent()) {
          stopSubmitting = true
          skipped += chunk.length
          inFlight -= 1
          maybeFinish()
          return
        }
        writeChunk(chunk, items)
      },
      () => {
        if (settled) return
        tasks.delete(task)
        if (cancelled) return
        skipped += chunk.length
        inFlight -= 1
        if (!isCurrent()) stopSubmitting = true
        pump()
      },
    )
  }

  function writeChunk(
    chunk: readonly PrewarmEntry[],
    items: readonly WorkerItemResult<WorkerParseResult>[],
  ): void {
    const entryByKey = new Map(chunk.map((entry) => [entry.key, entry]))
    const holder: { run: { cancel: () => void } | null } = { run: null }
    const run = runFrameBudgetTasks(
      items,
      (item) => {
        if (!isCurrent()) {
          holder.run?.cancel()
          return
        }
        const entry = entryByKey.get(item.key)
        if (!entry) return
        if (!item.ok) {
          skipped += 1
          return
        }
        try {
          const safe = String(options.sanitizeHtml(item.value.html, options.policy) || '')
          const blocks = splitTopLevelBlocks(safe)
          if (!blocks.length) {
            skipped += 1
            return
          }
          cache.put(entry.key, blocks, scope)
          written += 1
        } catch (_) {
          // 消毒失败只丢本条，绝不把失败降级结果写进缓存。
          skipped += 1
        }
      },
      {
        ...(options.frameBudget || {}),
        maxTasksPerSlice: PREWARM_WRITE_TASKS_PER_SLICE,
      },
    )
    holder.run = run
    writeRuns.add(run)

    const settleWrite = () => {
      writeRuns.delete(run)
      if (settled) return
      inFlight -= 1
      pump()
    }
    run.done.then(settleWrite, settleWrite)
  }

  function cancel(): void {
    if (cancelled || settled) return
    cancelled = true
    stopSubmitting = true
    for (const task of tasks) {
      try {
        task.cancel()
      } catch (_) {}
    }
    tasks.clear()
    for (const run of writeRuns) {
      try {
        run.cancel()
      } catch (_) {}
    }
    writeRuns.clear()
    inFlight = 0
    settle()
  }

  pump()

  return { cancel, done }
}
