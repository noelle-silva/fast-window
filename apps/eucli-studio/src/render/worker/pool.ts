// ============================================================================
// 通用 Worker 线程池
//
// 1. 队列必须有上限：线程数固定，提交速度超过处理速度时，无界队列只会把内存
//    压力和延迟藏起来。达到 maxPendingRequests 时立即失败，让调用方感知背压。
// 2. 结果必须按请求 id 回投：线程会复用，同一个线程先后处理不同请求，响应也可能
//    迟到；只有 id 能把响应准确归位，未知 id 一律丢弃。
// 3. 批量必须保序：切块只是并行手段，调用方拿到的数组必须与输入逐项对应，
//    因此按块序收集再拼接，而不是按线程完成先后拼接。
// ============================================================================

import {
  readWorkerRequestId,
  type WorkerError,
  type WorkerRequest,
  type WorkerRequestId,
  type WorkerRequestType,
  type WorkerSuccessResponse,
} from './protocol'

export type PoolMessageEvent = {
  data: unknown
}

export type PoolErrorEvent = {
  message?: string
  error?: unknown
}

// 与浏览器 Worker 结构兼容的最小端口，便于测试注入假线程。
export interface WorkerPort {
  postMessage(message: WorkerRequest): void
  addEventListener(type: 'message', listener: (event: PoolMessageEvent) => void): void
  addEventListener(type: 'messageerror', listener: (event: PoolMessageEvent) => void): void
  addEventListener(type: 'error', listener: (event: PoolErrorEvent) => void): void
  removeEventListener(type: 'message', listener: (event: PoolMessageEvent) => void): void
  removeEventListener(type: 'messageerror', listener: (event: PoolMessageEvent) => void): void
  removeEventListener(type: 'error', listener: (event: PoolErrorEvent) => void): void
  terminate(): void
}

export type WorkerFactory = (index: number) => WorkerPort

export type WorkerPoolOptions = {
  workerCount: number
  createWorker: WorkerFactory
  requestTimeoutMs: number
  maxPendingRequests: number
}

type RemoveRequestId<T> = T extends { id: WorkerRequestId } ? Omit<T, 'id'> : never

export type WorkerRequestInput = RemoveRequestId<WorkerRequest>

export type WorkerInputOf<TType extends WorkerRequestType> = Extract<
  WorkerRequestInput,
  { type: TType }
>

export type WorkerResultOf<TType extends WorkerRequestType> = Extract<
  WorkerSuccessResponse,
  { type: TType }
>['result']

export type WorkerTask<TResult> = {
  id: WorkerRequestId
  result: Promise<TResult>
  cancel: () => boolean
}

export type WorkerPoolErrorCode =
  | 'overloaded'
  | 'disposed'
  | 'cancelled'
  | 'timeout'
  | 'worker-crashed'
  | 'worker-start-failed'
  | 'request-failed'
  | 'protocol-error'

export type WorkerPoolErrorDetails = {
  requestId?: WorkerRequestId
  workerError?: WorkerError
}

export class WorkerPoolError extends Error {
  readonly code: WorkerPoolErrorCode
  readonly requestId: WorkerRequestId | null
  readonly workerError: WorkerError | null

  constructor(code: WorkerPoolErrorCode, message: string, details: WorkerPoolErrorDetails = {}) {
    super(message)
    this.name = 'WorkerPoolError'
    this.code = code
    this.requestId = details.requestId ?? null
    this.workerError = details.workerError ?? null
  }
}

type PendingTask = {
  id: WorkerRequestId
  request: WorkerRequest
  resolve: (response: WorkerSuccessResponse) => void
  reject: (error: unknown) => void
  settled: boolean
  worker: WorkerSlot | null
  timer: ReturnType<typeof setTimeout> | null
}

type WorkerSlot = {
  worker: WorkerPort
  state: 'starting' | 'idle' | 'busy'
  handshakeId: WorkerRequestId | null
  handshakeTimer: ReturnType<typeof setTimeout> | null
  task: PendingTask | null
  cleanup: () => void
}

type ParsedWorkerResponse =
  | { kind: 'success'; id: WorkerRequestId; response: WorkerSuccessResponse }
  | { kind: 'failure'; id: WorkerRequestId; error: WorkerError }
  | { kind: 'invalid'; id: WorkerRequestId; message: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function describeError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return String(error)
}

function readWorkerError(value: unknown): WorkerError | null {
  if (!isRecord(value) || typeof value.message !== 'string') return null
  return {
    name: typeof value.name === 'string' ? value.name : 'Error',
    message: value.message,
    ...(typeof value.stack === 'string' ? { stack: value.stack } : {}),
  }
}

function parseWorkerResponse(value: unknown): ParsedWorkerResponse | null {
  const id = readWorkerRequestId(value)
  if (id === null || !isRecord(value)) return null

  if (value.ok === false) {
    const error = readWorkerError(value.error)
    return {
      kind: 'failure',
      id,
      error: error ?? { name: 'Error', message: 'Worker 返回了无法识别的错误' },
    }
  }

  if (value.ok !== true) {
    return { kind: 'invalid', id, message: 'Worker 响应缺少 ok 标记' }
  }

  if (typeof value.type !== 'string' || !isRecord(value.result)) {
    return { kind: 'invalid', id, message: 'Worker 成功响应缺少 type 或 result' }
  }

  return {
    kind: 'success',
    id,
    response: value as unknown as WorkerSuccessResponse,
  }
}

export function createParserWorker(): WorkerPort {
  return new Worker(new URL('./parser.worker.ts', import.meta.url), { type: 'module' })
}

export class WorkerPool {
  readonly size: number
  private readonly createWorker: WorkerFactory
  private readonly requestTimeoutMs: number
  private readonly maxPendingRequests: number

  private readonly workers = new Set<WorkerSlot>()
  private readonly queue: PendingTask[] = []
  private readonly tasks = new Map<WorkerRequestId, PendingTask>()

  private disposed = false
  private pumping = false
  private pendingTasks = 0
  private nextRequestId = 1
  private nextHandshakeId = 0
  private nextWorkerIndex = 0

  constructor(options: WorkerPoolOptions) {
    if (!Number.isInteger(options.workerCount) || options.workerCount < 1) {
      throw new RangeError('workerCount 必须是大于 0 的整数')
    }
    if (!Number.isInteger(options.maxPendingRequests) || options.maxPendingRequests < 1) {
      throw new RangeError('maxPendingRequests 必须是大于 0 的整数')
    }
    if (!Number.isFinite(options.requestTimeoutMs) || options.requestTimeoutMs <= 0) {
      throw new RangeError('requestTimeoutMs 必须是大于 0 的有限数字')
    }
    if (typeof options.createWorker !== 'function') {
      throw new TypeError('createWorker 必须是函数')
    }

    this.size = options.workerCount
    this.createWorker = options.createWorker
    this.requestTimeoutMs = options.requestTimeoutMs
    this.maxPendingRequests = options.maxPendingRequests
  }

  get pendingCount(): number {
    return this.pendingTasks
  }

  get queuedCount(): number {
    return this.queue.length
  }

  get workerCount(): number {
    return this.workers.size
  }

  submit<TType extends WorkerRequestType>(
    input: WorkerInputOf<TType>,
  ): WorkerTask<WorkerResultOf<TType>> {
    this.assertUsable()
    const request = this.attachRequestId(input, this.allocateRequestId())
    return this.enqueue(request, (response) => response.result as WorkerResultOf<TType>)
  }

  async request<TType extends WorkerRequestType>(
    input: WorkerInputOf<TType>,
  ): Promise<WorkerResultOf<TType>> {
    return this.submit(input).result
  }

  cancel(id: WorkerRequestId): boolean {
    const task = this.tasks.get(id)
    if (!task || task.settled) return false

    this.markSettled(task)

    if (task.worker) {
      // 在途请求无法从线程内部撤回：立即拒绝调用方，但保留槽位与定时器，
      // 等迟到响应或超时来回收线程；迟到结果不会再次回投。
      task.reject(
        new WorkerPoolError('cancelled', `请求 ${id} 已取消`, { requestId: id }),
      )
      return true
    }

    const index = this.queue.indexOf(task)
    if (index !== -1) this.queue.splice(index, 1)
    this.clearTaskTimer(task)
    task.reject(new WorkerPoolError('cancelled', `请求 ${id} 已取消`, { requestId: id }))
    return true
  }

  async runBatch<TItem, TInput extends WorkerRequestInput, TResult>(
    items: readonly TItem[],
    buildRequest: (chunk: readonly TItem[]) => TInput,
    extractItems: (result: WorkerResultOf<TInput['type']>) => readonly TResult[],
  ): Promise<TResult[]> {
    this.assertUsable()
    if (items.length === 0) return []

    const available = this.maxPendingRequests - this.pendingTasks
    if (available <= 0) {
      throw new WorkerPoolError(
        'overloaded',
        `线程池已达并发上限 ${this.maxPendingRequests}，拒绝批量请求`,
      )
    }

    const chunkCount = Math.min(this.size, available, items.length)
    const chunkSize = Math.ceil(items.length / chunkCount)
    const chunks: TItem[][] = []

    for (let start = 0; start < items.length; start += chunkSize) {
      chunks.push(items.slice(start, start + chunkSize))
    }

    const requests = chunks.map(buildRequest)
    const groups = requests.map((input) => {
      const request = this.attachRequestId(input, this.allocateRequestId())
      const task = this.enqueue(
        request,
        (response) => response.result as WorkerResultOf<TInput['type']>,
      )
      return task.result.then(extractItems)
    })

    const results = await Promise.all(groups)
    return results.flat()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true

    const disposedError = (id: WorkerRequestId): WorkerPoolError =>
      new WorkerPoolError('disposed', `线程池已释放，请求 ${id} 被拒绝`, { requestId: id })

    for (const task of this.queue) {
      this.markSettled(task)
      this.clearTaskTimer(task)
      task.reject(disposedError(task.id))
    }
    this.queue.length = 0

    for (const slot of [...this.workers]) {
      const task = slot.task
      if (task) {
        const wasPending = !task.settled
        slot.task = null
        task.worker = null
        this.clearTaskTimer(task)
        if (wasPending) {
          this.markSettled(task)
          task.reject(disposedError(task.id))
        }
      }
      this.removeWorker(slot)
    }
  }

  private assertUsable(): void {
    if (this.disposed) {
      throw new WorkerPoolError('disposed', '线程池已释放，不再接收新请求')
    }
    if (this.pendingTasks >= this.maxPendingRequests) {
      throw new WorkerPoolError(
        'overloaded',
        `线程池已达并发上限 ${this.maxPendingRequests}，拒绝新请求`,
      )
    }
  }

  private allocateRequestId(): WorkerRequestId {
    return this.nextRequestId++
  }

  private attachRequestId(input: WorkerRequestInput, id: WorkerRequestId): WorkerRequest {
    return { ...input, id } as WorkerRequest
  }

  private enqueue<TResult>(
    request: WorkerRequest,
    extract: (response: WorkerSuccessResponse) => TResult,
  ): WorkerTask<TResult> {
    let settle: (value: TResult) => void = () => {}
    let fail: (reason: unknown) => void = () => {}

    const result = new Promise<TResult>((resolve, reject) => {
      settle = resolve
      fail = reject
    })

    const task: PendingTask = {
      id: request.id,
      request,
      resolve: (response) => settle(extract(response)),
      reject: fail,
      settled: false,
      worker: null,
      timer: null,
    }

    this.tasks.set(task.id, task)
    this.pendingTasks += 1
    this.queue.push(task)
    this.pump()

    return {
      id: task.id,
      result,
      cancel: () => this.cancel(task.id),
    }
  }

  private pump(): void {
    if (this.disposed || this.pumping) return
    this.pumping = true

    try {
      while (!this.disposed) {
        while (this.queue.length > 0) {
          const slot = this.findIdleWorker()
          if (!slot) break
          this.dispatchTask(slot, this.queue.shift() as PendingTask)
        }

        if (this.queue.length === 0) break

        const capacity = this.size - this.workers.size
        const need = this.queue.length - this.countStartingWorkers()
        if (capacity <= 0 || need <= 0) break

        try {
          this.startWorker()
        } catch (error) {
          this.failNextQueued(
            (requestId) =>
              new WorkerPoolError(
                'worker-start-failed',
                `Worker 创建失败：${describeError(error)}`,
                { requestId },
              ),
          )
        }
      }
    } finally {
      this.pumping = false
    }
  }

  private startWorker(): void {
    if (this.disposed || this.workers.size >= this.size) return

    const worker = this.createWorker(this.nextWorkerIndex++)
    const handshakeId = this.nextHandshakeId--
    const slot: WorkerSlot = {
      worker,
      state: 'starting',
      handshakeId,
      handshakeTimer: null,
      task: null,
      cleanup: () => {},
    }

    const onMessage = (event: PoolMessageEvent): void => {
      this.handleWorkerMessage(slot, event.data)
    }
    const onMessageError = (): void => {
      this.handleWorkerFailure(slot, 'Worker 消息反序列化失败')
    }
    const onError = (event: PoolErrorEvent): void => {
      this.handleWorkerFailure(slot, this.describeWorkerError(event))
    }

    slot.cleanup = () => {
      worker.removeEventListener('message', onMessage)
      worker.removeEventListener('messageerror', onMessageError)
      worker.removeEventListener('error', onError)
    }

    worker.addEventListener('message', onMessage)
    worker.addEventListener('messageerror', onMessageError)
    worker.addEventListener('error', onError)
    this.workers.add(slot)

    slot.handshakeTimer = setTimeout(() => this.handleHandshakeTimeout(slot), this.requestTimeoutMs)

    try {
      worker.postMessage({ id: handshakeId, type: 'ping' })
    } catch (error) {
      this.removeWorker(slot)
      throw new WorkerPoolError(
        'worker-start-failed',
        `Worker 握手发送失败：${describeError(error)}`,
      )
    }
  }

  private removeWorker(slot: WorkerSlot): boolean {
    if (!this.workers.delete(slot)) return false

    if (slot.handshakeTimer !== null) {
      clearTimeout(slot.handshakeTimer)
      slot.handshakeTimer = null
    }
    slot.handshakeId = null
    slot.cleanup()
    slot.worker.terminate()
    return true
  }

  private findIdleWorker(): WorkerSlot | null {
    for (const slot of this.workers) {
      if (slot.state === 'idle') return slot
    }
    return null
  }

  private countStartingWorkers(): number {
    let count = 0
    for (const slot of this.workers) {
      if (slot.state === 'starting') count += 1
    }
    return count
  }

  private dispatchTask(slot: WorkerSlot, task: PendingTask): void {
    slot.state = 'busy'
    slot.task = task
    task.worker = slot
    task.timer = setTimeout(
      () => this.handleTaskTimeout(slot, task),
      this.requestTimeoutMs,
    )

    try {
      slot.worker.postMessage(task.request)
    } catch (error) {
      this.destroyWorkerAndFailTask(
        slot,
        task,
        new WorkerPoolError(
          'worker-crashed',
          `Worker 发送请求失败：${describeError(error)}`,
          { requestId: task.id },
        ),
      )
    }
  }

  private handleWorkerMessage(slot: WorkerSlot, data: unknown): void {
    if (this.disposed) return

    const parsed = parseWorkerResponse(data)
    if (!parsed) return

    if (slot.state === 'starting') {
      this.finishHandshake(slot, parsed)
      return
    }

    const task = slot.task
    if (!task || task.id !== parsed.id) return

    if (task.settled) {
      this.clearTaskTimer(task)
      if (slot.task === task) {
        slot.task = null
        slot.state = 'idle'
      }
      task.worker = null
      this.pump()
      return
    }

    if (parsed.kind === 'success') {
      if (parsed.response.type !== task.request.type) {
        this.destroyWorkerAndFailTask(
          slot,
          task,
          new WorkerPoolError(
            'protocol-error',
            `请求 ${task.id} 的响应类型 ${parsed.response.type} 与请求类型 ${task.request.type} 不匹配`,
            { requestId: task.id },
          ),
        )
        return
      }
      this.resolveTask(task, parsed.response)
      return
    }

    if (parsed.kind === 'failure') {
      this.rejectTask(
        task,
        new WorkerPoolError('request-failed', parsed.error.message, {
          requestId: task.id,
          workerError: parsed.error,
        }),
      )
      return
    }

    this.destroyWorkerAndFailTask(
      slot,
      task,
      new WorkerPoolError('protocol-error', parsed.message, { requestId: task.id }),
    )
  }

  private finishHandshake(slot: WorkerSlot, parsed: ParsedWorkerResponse): void {
    if (slot.state !== 'starting' || parsed.id !== slot.handshakeId) return

    if (parsed.kind === 'success' && parsed.response.type === 'ping') {
      if (slot.handshakeTimer !== null) {
        clearTimeout(slot.handshakeTimer)
        slot.handshakeTimer = null
      }
      slot.handshakeId = null
      slot.state = 'idle'
      this.pump()
      return
    }

    const message =
      parsed.kind === 'failure'
        ? parsed.error.message
        : parsed.kind === 'invalid'
          ? parsed.message
          : `握手响应类型 ${parsed.response.type} 不正确`
    this.failWorkerStart(
      slot,
      `Worker 握手失败：${message}`,
      parsed.kind === 'failure' ? parsed.error : undefined,
    )
  }

  private handleHandshakeTimeout(slot: WorkerSlot): void {
    slot.handshakeTimer = null
    if (this.disposed || slot.state !== 'starting') return
    this.failWorkerStart(
      slot,
      `Worker 在 ${this.requestTimeoutMs}ms 内未完成握手`,
    )
  }

  private handleWorkerFailure(slot: WorkerSlot, message: string): void {
    if (this.disposed) return

    if (slot.state === 'starting') {
      this.failWorkerStart(slot, `Worker 启动失败：${message}`)
      return
    }

    const task = slot.task
    const pendingTask = task && !task.settled ? task : null

    if (task) {
      if (slot.task === task) slot.task = null
      task.worker = null
      this.clearTaskTimer(task)
      if (!task.settled) this.markSettled(task)
    }

    this.removeWorker(slot)

    if (pendingTask) {
      pendingTask.reject(
        new WorkerPoolError('worker-crashed', `Worker 线程崩溃：${message}`, {
          requestId: pendingTask.id,
        }),
      )
    }

    this.rebuildAfterFailure()
  }

  private handleTaskTimeout(slot: WorkerSlot, task: PendingTask): void {
    task.timer = null
    if (slot.task !== task) return
    this.destroyWorkerAndFailTask(
      slot,
      task,
      new WorkerPoolError(
        'timeout',
        `请求 ${task.id} 在 ${this.requestTimeoutMs}ms 内未完成`,
        { requestId: task.id },
      ),
    )
  }

  private failWorkerStart(
    slot: WorkerSlot,
    message: string,
    workerError?: WorkerError,
  ): void {
    if (!this.removeWorker(slot)) return

    this.failNextQueued(
      (requestId) =>
        new WorkerPoolError('worker-start-failed', message, { requestId, workerError }),
    )
    this.pump()
  }

  private failNextQueued(createError: (requestId: WorkerRequestId) => WorkerPoolError): void {
    const task = this.queue.shift()
    if (!task) return

    this.markSettled(task)
    this.clearTaskTimer(task)
    task.reject(createError(task.id))
  }

  private rebuildAfterFailure(): void {
    if (this.disposed) return

    if (this.workers.size < this.size) {
      try {
        this.startWorker()
      } catch (error) {
        this.failNextQueued(
          (requestId) =>
            new WorkerPoolError(
              'worker-start-failed',
              `Worker 重建失败：${describeError(error)}`,
              { requestId },
            ),
        )
      }
    }

    this.pump()
  }

  private destroyWorkerAndFailTask(
    slot: WorkerSlot,
    task: PendingTask,
    error: WorkerPoolError,
  ): void {
    const wasPending = !task.settled

    if (slot.task === task) slot.task = null
    task.worker = null
    this.clearTaskTimer(task)
    if (wasPending) this.markSettled(task)

    this.removeWorker(slot)

    if (wasPending) task.reject(error)
    this.rebuildAfterFailure()
  }

  private resolveTask(task: PendingTask, response: WorkerSuccessResponse): void {
    if (task.settled) return

    this.markSettled(task)
    this.detachTask(task)
    task.resolve(response)
    this.pump()
  }

  private rejectTask(task: PendingTask, error: WorkerPoolError): void {
    if (task.settled) return

    this.markSettled(task)
    this.detachTask(task)
    task.reject(error)
    this.pump()
  }

  private markSettled(task: PendingTask): void {
    task.settled = true
    this.pendingTasks -= 1
    this.tasks.delete(task.id)
  }

  private detachTask(task: PendingTask): void {
    this.clearTaskTimer(task)

    const slot = task.worker
    task.worker = null
    if (slot && slot.task === task) {
      slot.task = null
      slot.state = 'idle'
    }
  }

  private clearTaskTimer(task: PendingTask): void {
    if (task.timer === null) return
    clearTimeout(task.timer)
    task.timer = null
  }

  private describeWorkerError(event: PoolErrorEvent): string {
    if (typeof event.message === 'string' && event.message) return event.message
    if (event.error instanceof Error && event.error.message) return event.error.message
    return 'Worker 线程异常'
  }
}
