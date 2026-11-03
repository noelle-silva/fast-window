import { WorkerPool, createParserWorker, type WorkerInputOf, type WorkerResultOf, type WorkerTask } from './pool'
import type {
  WorkerItemResult,
  WorkerMathBatchItem,
  WorkerMathResult,
  WorkerParseBatchItem,
  WorkerParseResult,
  WorkerRequestType,
  WorkerStickerPathMap,
} from './protocol'

// ============================================================================
// 渲染侧线程池适配（批量预计算）
//
// 当前逐条渲染路径不依赖本文件；本文件保留为「打开会话时整批预计算」的适配层：
//   - 池实例由调用方持有，引擎与能力模块都不自行创建 Worker；
//   - 超时、背压、线程重建全部由 WorkerPool 负责，这里不另造一套；
//   - 结果按任务语义收敛成「HTML 字符串 / 公式逐项结果」，协议细节不外溢。
// ============================================================================

export type RenderWorkerPool = {
  submit<TType extends WorkerRequestType>(
    input: WorkerInputOf<TType>,
  ): WorkerTask<WorkerResultOf<TType>>
}

export type RenderWorkerTask<T> = {
  result: Promise<T>
  cancel: () => boolean
}

export type ParseWorkerOptions = {
  stickersEnabled?: boolean
  stickerPaths?: WorkerStickerPathMap
}

export function submitParse(
  pool: RenderWorkerPool,
  source: string,
  options?: ParseWorkerOptions,
): RenderWorkerTask<string> {
  const input: WorkerInputOf<'parse'> = { type: 'parse', source }
  if (options?.stickersEnabled !== undefined) input.stickersEnabled = options.stickersEnabled
  if (options?.stickerPaths !== undefined) input.stickerPaths = options.stickerPaths

  const task = pool.submit(input)
  return {
    result: task.result.then((result) => result.html),
    cancel: task.cancel,
  }
}

// 预计算是「一次算一批」：批量协议避免每条消息一次往返，
// 线程池按 id 与块序保证结果与输入逐项对应。
export function submitParseBatch(
  pool: RenderWorkerPool,
  items: readonly WorkerParseBatchItem[],
  options?: ParseWorkerOptions,
): RenderWorkerTask<WorkerItemResult<WorkerParseResult>[]> {
  const input: WorkerInputOf<'parse-batch'> = { type: 'parse-batch', items: [...items] }
  if (options?.stickersEnabled !== undefined) input.stickersEnabled = options.stickersEnabled
  if (options?.stickerPaths !== undefined) input.stickerPaths = options.stickerPaths

  const task = pool.submit(input)
  return {
    result: task.result.then((result) => result.items),
    cancel: task.cancel,
  }
}

export function submitMath(
  pool: RenderWorkerPool,
  items: readonly WorkerMathBatchItem[],
): RenderWorkerTask<WorkerItemResult<WorkerMathResult>[]> {
  const task = pool.submit({ type: 'math-batch', items: [...items] })
  return {
    result: task.result.then((result) => result.items),
    cancel: task.cancel,
  }
}

// 渲染线程数量固定且很小：解析是短任务，过多线程只会增加调度与内存成本。
const RENDER_WORKER_COUNT = 2
const RENDER_WORKER_TIMEOUT_MS = 5000
// 队列上限同时是背压阈值：超过后立即失败，由引擎回退同步渲染。
const RENDER_WORKER_MAX_PENDING = 16

export function createRenderWorkerPool(): WorkerPool {
  return new WorkerPool({
    workerCount: RENDER_WORKER_COUNT,
    createWorker: createParserWorker,
    requestTimeoutMs: RENDER_WORKER_TIMEOUT_MS,
    maxPendingRequests: RENDER_WORKER_MAX_PENDING,
  })
}
