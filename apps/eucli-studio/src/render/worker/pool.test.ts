import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  WorkerPool,
  WorkerPoolError,
  type PoolErrorEvent,
  type PoolMessageEvent,
  type WorkerPoolOptions,
  type WorkerPort,
} from './pool'
import {
  WORKER_PROTOCOL_VERSION,
  type WorkerParseBatchRequest,
  type WorkerParseRequest,
  type WorkerRequest,
  type WorkerResponse,
  type WorkerSuccessResponse,
} from './protocol'

// ============================================================================
// 线程池测试：全部使用注入的假线程，不依赖真实浏览器 Worker。
// 假线程自动完成握手，业务请求可按用例选择自动、手动或静默应答。
// ============================================================================

type FakeMode = 'auto' | 'manual' | 'silent'

type FakeFactory = {
  workers: FakeWorkerPort[]
  create: (index: number) => WorkerPort
}

function createParseResponse(request: WorkerParseRequest): WorkerSuccessResponse {
  return {
    id: request.id,
    type: 'parse',
    ok: true,
    result: { html: `<p>${request.source}</p>` },
  }
}

function createParseBatchResponse(request: WorkerParseBatchRequest): WorkerSuccessResponse {
  return {
    id: request.id,
    type: 'parse-batch',
    ok: true,
    result: {
      items: request.items.map((item) => ({
        key: item.key,
        ok: true,
        value: { html: `<p>${item.source}</p>` },
      })),
    },
  }
}

function createAutoResponse(
  request: Exclude<WorkerRequest, { type: 'ping' }>,
): WorkerSuccessResponse {
  switch (request.type) {
    case 'parse':
      return createParseResponse(request)
    case 'parse-batch':
      return createParseBatchResponse(request)
    case 'math-batch':
      return {
        id: request.id,
        type: 'math-batch',
        ok: true,
        result: {
          items: request.items.map((item) => ({
            key: item.key,
            ok: true,
            value: { html: `math:${item.tex}` },
          })),
        },
      }
  }
}

class FakeWorkerPort implements WorkerPort {
  readonly messages: WorkerRequest[] = []
  terminated = false

  private readonly messageListeners = new Set<(event: PoolMessageEvent) => void>()
  private readonly messageErrorListeners = new Set<(event: PoolMessageEvent) => void>()
  private readonly errorListeners = new Set<(event: PoolErrorEvent) => void>()

  constructor(private readonly mode: FakeMode) {}

  get requests(): Exclude<WorkerRequest, { type: 'ping' }>[] {
    return this.messages.filter(
      (message): message is Exclude<WorkerRequest, { type: 'ping' }> => message.type !== 'ping',
    )
  }

  postMessage(message: WorkerRequest): void {
    this.messages.push(message)

    if (message.type === 'ping') {
      this.emitResponse({
        id: message.id,
        type: 'ping',
        ok: true,
        result: { protocolVersion: WORKER_PROTOCOL_VERSION },
      })
      return
    }

    if (this.mode === 'auto') this.emitResponse(createAutoResponse(message))
  }

  addEventListener(
    type: 'message' | 'messageerror',
    listener: (event: PoolMessageEvent) => void,
  ): void
  addEventListener(type: 'error', listener: (event: PoolErrorEvent) => void): void
  addEventListener(
    type: 'message' | 'messageerror' | 'error',
    listener: ((event: PoolMessageEvent) => void) | ((event: PoolErrorEvent) => void),
  ): void {
    if (type === 'error') {
      this.errorListeners.add(listener as (event: PoolErrorEvent) => void)
    } else if (type === 'messageerror') {
      this.messageErrorListeners.add(listener as (event: PoolMessageEvent) => void)
    } else {
      this.messageListeners.add(listener as (event: PoolMessageEvent) => void)
    }
  }

  removeEventListener(
    type: 'message' | 'messageerror',
    listener: (event: PoolMessageEvent) => void,
  ): void
  removeEventListener(type: 'error', listener: (event: PoolErrorEvent) => void): void
  removeEventListener(
    type: 'message' | 'messageerror' | 'error',
    listener: ((event: PoolMessageEvent) => void) | ((event: PoolErrorEvent) => void),
  ): void {
    if (type === 'error') {
      this.errorListeners.delete(listener as (event: PoolErrorEvent) => void)
    } else if (type === 'messageerror') {
      this.messageErrorListeners.delete(listener as (event: PoolMessageEvent) => void)
    } else {
      this.messageListeners.delete(listener as (event: PoolMessageEvent) => void)
    }
  }

  terminate(): void {
    this.terminated = true
  }

  respond(response: WorkerResponse): void {
    this.emitResponse(response)
  }

  crash(message = '线程异常终止'): void {
    queueMicrotask(() => {
      for (const listener of [...this.errorListeners]) listener({ message })
    })
  }

  private emitResponse(response: WorkerResponse): void {
    queueMicrotask(() => {
      for (const listener of [...this.messageListeners]) listener({ data: response })
    })
  }
}

function createFakeFactory(mode: FakeMode): FakeFactory {
  const workers: FakeWorkerPort[] = []
  return {
    workers,
    create: () => {
      const worker = new FakeWorkerPort(mode)
      workers.push(worker)
      return worker
    },
  }
}

async function flushMicrotasks(): Promise<void> {
  for (let round = 0; round < 6; round += 1) {
    await Promise.resolve()
  }
}

const openPools: WorkerPool[] = []

function createPool(
  mode: FakeMode,
  overrides: Partial<Omit<WorkerPoolOptions, 'createWorker'>> = {},
): { pool: WorkerPool; factory: FakeFactory } {
  const factory = createFakeFactory(mode)
  const pool = new WorkerPool({
    workerCount: 2,
    requestTimeoutMs: 1000,
    maxPendingRequests: 10,
    ...overrides,
    createWorker: factory.create,
  })
  openPools.push(pool)
  return { pool, factory }
}

afterEach(() => {
  for (const pool of openPools.splice(0)) pool.dispose()
  vi.useRealTimers()
})

describe('WorkerPool 正常请求', () => {
  it('首次请求才创建线程，并按协议返回结果', async () => {
    const { pool, factory } = createPool('auto', { workerCount: 2 })

    expect(factory.workers).toHaveLength(0)

    const task = pool.submit({ type: 'parse', source: '甲' })
    expect(task.id).toBe(1)
    expect(factory.workers).toHaveLength(1)

    await expect(task.result).resolves.toEqual({ html: '<p>甲</p>' })
    await expect(pool.request({ type: 'parse', source: '乙' })).resolves.toEqual({
      html: '<p>乙</p>',
    })
    expect(pool.pendingCount).toBe(0)
  })

  it('线程返回失败响应时只拒绝对应请求，线程继续可用', async () => {
    const { pool, factory } = createPool('manual', { workerCount: 1 })

    const failed = pool.submit({ type: 'parse', source: '坏' })
    await flushMicrotasks()

    const worker = factory.workers[0]
    const failedRequest = worker.requests[0]
    if (failedRequest.type !== 'parse') throw new Error('预期 parse 请求')

    worker.respond({
      id: failedRequest.id,
      ok: false,
      error: { name: 'ParseError', message: '解析失败' },
    })

    await expect(failed.result).rejects.toMatchObject({
      code: 'request-failed',
      workerError: { name: 'ParseError', message: '解析失败' },
    })
    expect(worker.terminated).toBe(false)

    const next = pool.submit({ type: 'parse', source: '好' })
    await flushMicrotasks()
    expect(worker.requests).toHaveLength(2)
    const nextRequest = worker.requests[1]
    if (nextRequest.type !== 'parse') throw new Error('预期 parse 请求')
    worker.respond(createParseResponse(nextRequest))

    await expect(next.result).resolves.toEqual({ html: '<p>好</p>' })
  })
})

describe('WorkerPool 背压与排队', () => {
  it('全部忙碌时排队，超过总上限明确失败', async () => {
    const { pool, factory } = createPool('manual', {
      workerCount: 1,
      maxPendingRequests: 2,
    })

    const first = pool.submit({ type: 'parse', source: '一' })
    const second = pool.submit({ type: 'parse', source: '二' })
    await flushMicrotasks()

    expect(factory.workers).toHaveLength(1)
    expect(factory.workers[0].requests).toHaveLength(1)
    expect(pool.queuedCount).toBe(1)
    expect(pool.pendingCount).toBe(2)

    expect(() => pool.submit({ type: 'parse', source: '三' })).toThrowError(WorkerPoolError)
    await expect(pool.request({ type: 'parse', source: '四' })).rejects.toMatchObject({
      code: 'overloaded',
    })

    const worker = factory.workers[0]
    const firstRequest = worker.requests[0]
    if (firstRequest.type !== 'parse') throw new Error('预期 parse 请求')
    worker.respond(createParseResponse(firstRequest))
    await expect(first.result).resolves.toEqual({ html: '<p>一</p>' })
    await flushMicrotasks()

    expect(worker.requests).toHaveLength(2)
    const secondRequest = worker.requests[1]
    if (secondRequest.type !== 'parse') throw new Error('预期 parse 请求')
    worker.respond(createParseResponse(secondRequest))
    await expect(second.result).resolves.toEqual({ html: '<p>二</p>' })
    expect(pool.pendingCount).toBe(0)
  })
})

describe('WorkerPool 超时', () => {
  it('请求超时后失败并终止卡住的线程', async () => {
    vi.useFakeTimers()
    const { pool, factory } = createPool('silent', {
      workerCount: 1,
      requestTimeoutMs: 50,
      maxPendingRequests: 2,
    })

    const task = pool.submit({ type: 'parse', source: '慢' })
    await vi.advanceTimersByTimeAsync(0)

    const worker = factory.workers[0]
    expect(worker.requests).toHaveLength(1)

    const rejection = expect(task.result).rejects.toMatchObject({ code: 'timeout' })
    await vi.advanceTimersByTimeAsync(50)
    await rejection

    expect(worker.terminated).toBe(true)
    expect(factory.workers).toHaveLength(2)
    expect(pool.pendingCount).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('WorkerPool 崩溃隔离', () => {
  it('一个线程崩溃只让它负责的请求失败，其他在途请求不受影响', async () => {
    const { pool, factory } = createPool('manual', {
      workerCount: 2,
      requestTimeoutMs: 5000,
    })

    const first = pool.submit({ type: 'parse', source: '会崩' })
    const second = pool.submit({ type: 'parse', source: '不受影响' })
    await flushMicrotasks()

    expect(factory.workers).toHaveLength(2)
    const crashedWorker = factory.workers[0]
    const healthyWorker = factory.workers[1]
    const healthyRequest = healthyWorker.requests[0]
    if (healthyRequest.type !== 'parse') throw new Error('预期 parse 请求')

    const rejection = expect(first.result).rejects.toMatchObject({ code: 'worker-crashed' })
    crashedWorker.crash('boom')
    await rejection

    expect(crashedWorker.terminated).toBe(true)
    expect(healthyWorker.terminated).toBe(false)

    healthyWorker.respond(createParseResponse(healthyRequest))
    await expect(second.result).resolves.toEqual({ html: '<p>不受影响</p>' })
    expect(pool.pendingCount).toBe(0)
  })

  it('线程崩溃后自动重建，池子继续服务', async () => {
    const { pool, factory } = createPool('manual', { workerCount: 1 })

    const first = pool.submit({ type: 'parse', source: '会崩' })
    await flushMicrotasks()

    const crashedWorker = factory.workers[0]
    const rejection = expect(first.result).rejects.toMatchObject({ code: 'worker-crashed' })
    crashedWorker.crash('boom')
    await rejection
    await flushMicrotasks()

    expect(crashedWorker.terminated).toBe(true)
    expect(factory.workers).toHaveLength(2)

    const second = pool.submit({ type: 'parse', source: '恢复' })
    await flushMicrotasks()

    const rebuiltWorker = factory.workers[1]
    expect(rebuiltWorker.requests).toHaveLength(1)
    const request = rebuiltWorker.requests[0]
    if (request.type !== 'parse') throw new Error('预期 parse 请求')
    rebuiltWorker.respond(createParseResponse(request))

    await expect(second.result).resolves.toEqual({ html: '<p>恢复</p>' })
    expect(pool.pendingCount).toBe(0)
  })
})

describe('WorkerPool 取消', () => {
  it('取消排队请求后不再派发，取消在途请求后不再回投结果', async () => {
    const { pool, factory } = createPool('manual', { workerCount: 1, maxPendingRequests: 3 })

    const first = pool.submit({ type: 'parse', source: '一' })
    const queued = pool.submit({ type: 'parse', source: '二' })
    await flushMicrotasks()

    const worker = factory.workers[0]
    const queuedRejection = expect(queued.result).rejects.toMatchObject({ code: 'cancelled' })
    expect(queued.cancel()).toBe(true)
    await queuedRejection
    expect(worker.requests).toHaveLength(1)

    const firstRequest = worker.requests[0]
    if (firstRequest.type !== 'parse') throw new Error('预期 parse 请求')
    worker.respond(createParseResponse(firstRequest))
    await expect(first.result).resolves.toEqual({ html: '<p>一</p>' })
    await flushMicrotasks()

    const inFlight = pool.submit({ type: 'parse', source: '三' })
    await flushMicrotasks()
    expect(worker.requests).toHaveLength(2)

    const delivered = vi.fn()
    void inFlight.result.then(delivered, () => {})
    const inFlightRejection = expect(inFlight.result).rejects.toMatchObject({ code: 'cancelled' })
    expect(inFlight.cancel()).toBe(true)
    await inFlightRejection

    const lateRequest = worker.requests[1]
    if (lateRequest.type !== 'parse') throw new Error('预期 parse 请求')
    worker.respond(createParseResponse(lateRequest))
    await flushMicrotasks()

    expect(delivered).not.toHaveBeenCalled()
    expect(worker.terminated).toBe(false)

    const afterLate = pool.submit({ type: 'parse', source: '四' })
    await flushMicrotasks()
    expect(worker.requests).toHaveLength(3)
    const afterLateRequest = worker.requests[2]
    if (afterLateRequest.type !== 'parse') throw new Error('预期 parse 请求')
    worker.respond(createParseResponse(afterLateRequest))
    await expect(afterLate.result).resolves.toEqual({ html: '<p>四</p>' })
  })
})

describe('WorkerPool 释放', () => {
  it('dispose 后拒绝新请求、清空队列并终止所有线程', async () => {
    vi.useFakeTimers()
    const { pool, factory } = createPool('manual', {
      workerCount: 1,
      maxPendingRequests: 3,
    })

    const first = pool.submit({ type: 'parse', source: '一' })
    const second = pool.submit({ type: 'parse', source: '二' })
    const third = pool.submit({ type: 'parse', source: '三' })
    await vi.advanceTimersByTimeAsync(0)

    const rejections = [
      expect(first.result).rejects.toMatchObject({ code: 'disposed' }),
      expect(second.result).rejects.toMatchObject({ code: 'disposed' }),
      expect(third.result).rejects.toMatchObject({ code: 'disposed' }),
    ]

    pool.dispose()
    await Promise.all(rejections)

    expect(factory.workers[0].terminated).toBe(true)
    expect(pool.workerCount).toBe(0)
    expect(pool.queuedCount).toBe(0)
    expect(pool.pendingCount).toBe(0)
    expect(vi.getTimerCount()).toBe(0)

    let thrown: unknown
    try {
      pool.submit({ type: 'parse', source: '四' })
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(WorkerPoolError)
    expect((thrown as WorkerPoolError).code).toBe('disposed')
    await expect(pool.request({ type: 'parse', source: '五' })).rejects.toMatchObject({
      code: 'disposed',
    })
  })
})

describe('WorkerPool 批量分发', () => {
  it('按块并行但仍按原始输入顺序返回，块数不超过线程数', async () => {
    const { pool, factory } = createPool('manual', {
      workerCount: 2,
      requestTimeoutMs: 5000,
    })
    const items = ['a', 'b', 'c', 'd', 'e', 'f']

    const batch = pool.runBatch(
      items,
      (chunk) => ({
        type: 'parse-batch',
        items: chunk.map((source) => ({ key: source, source })),
      }),
      (result) => result.items.map((item) => item.key),
    )
    await flushMicrotasks()

    expect(factory.workers).toHaveLength(2)
    const requests = factory.workers.flatMap((worker) =>
      worker.requests.filter((request) => request.type === 'parse-batch'),
    )
    expect(requests.length).toBeLessThanOrEqual(pool.size)
    expect(requests).toHaveLength(2)

    const lateRequest = factory.workers[1].requests[0]
    if (lateRequest.type !== 'parse-batch') throw new Error('预期 parse-batch 请求')
    factory.workers[1].respond(createParseBatchResponse(lateRequest))
    await flushMicrotasks()

    const earlyRequest = factory.workers[0].requests[0]
    if (earlyRequest.type !== 'parse-batch') throw new Error('预期 parse-batch 请求')
    factory.workers[0].respond(createParseBatchResponse(earlyRequest))

    await expect(batch).resolves.toEqual(items)
  })

  it('十项输入在三个线程下只切三块并保序', async () => {
    const { pool, factory } = createPool('auto', { workerCount: 3, maxPendingRequests: 20 })
    const items = Array.from({ length: 10 }, (_, index) => `item-${index}`)

    const result = await pool.runBatch(
      items,
      (chunk) => ({
        type: 'parse-batch',
        items: chunk.map((source) => ({ key: source, source })),
      }),
      (batchResult) => batchResult.items.map((item) => item.key),
    )

    const requests = factory.workers.flatMap((worker) => worker.requests)
    expect(requests).toHaveLength(3)
    expect(requests.length).toBeLessThanOrEqual(pool.size)
    expect(result).toEqual(items)
  })
})
