import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRequestRecordsController } from './requestRecords'

function recordSummary(id: string) {
  return {
    id,
    createdAt: '2026-01-01T00:00:00.000Z',
    method: 'POST',
    url: '/v1/messages',
    status: 200,
    durationMs: 10,
    error: '',
  }
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: any) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function createHarness(handler: (request: any) => any = () => ({ status: 200, body: { data: [] } })) {
  const state: any = {}
  const requests: any[] = []
  const toasts: string[] = []
  let emitCount = 0

  const controller = createRequestRecordsController({
    getState: () => state,
    netRequest: async (request: any) => {
      requests.push(request)
      return handler(request)
    },
    emit: () => {
      emitCount += 1
    },
    showToast: (message: string) => {
      toasts.push(message)
    },
  })

  return { state, requests, toasts, controller, emitCount: () => emitCount }
}

describe('request records controller', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('reuses fresh results unless a refresh is forced', async () => {
    const harness = createHarness(() => ({ status: 200, body: { data: [recordSummary('record-1')] } }))

    await harness.controller.refreshRequestRecords({ force: true })
    expect(harness.state.requestRecords.items).toHaveLength(1)

    await harness.controller.refreshRequestRecords()
    expect(harness.requests).toHaveLength(1)

    await harness.controller.refreshRequestRecords({ force: true })
    expect(harness.requests).toHaveLength(2)
  })

  it('shares one network request across overlapping refreshes', async () => {
    const gate = createDeferred<any>()
    const harness = createHarness(() => gate.promise)

    const first = harness.controller.refreshRequestRecords({ force: true })
    const second = harness.controller.refreshRequestRecords({ force: true })

    expect(harness.requests).toHaveLength(1)

    gate.resolve({ status: 200, body: { data: [recordSummary('record-1')] } })
    const [firstItems, secondItems] = await Promise.all([first, second])

    expect(firstItems).toBe(secondItems)
    expect(harness.state.requestRecords.items).toHaveLength(1)
  })

  it('refreshes without the blocking loading state when rows already exist', async () => {
    const gate = createDeferred<any>()
    let requestCount = 0
    const harness = createHarness(() => {
      requestCount += 1
      if (requestCount === 1) return { status: 200, body: { data: [recordSummary('record-1')] } }
      return gate.promise
    })

    await harness.controller.refreshRequestRecords({ force: true })
    const pending = harness.controller.refreshRequestRecords({ force: true })

    expect(harness.state.requestRecords.loading).toBe(false)

    gate.resolve({ status: 200, body: { data: [recordSummary('record-1'), recordSummary('record-2')] } })
    await pending

    expect(harness.state.requestRecords.items).toHaveLength(2)
  })

  it('shows the loading state for an explicit foreground refresh', async () => {
    const gate = createDeferred<any>()
    let requestCount = 0
    const harness = createHarness(() => {
      requestCount += 1
      if (requestCount === 1) return { status: 200, body: { data: [recordSummary('record-1')] } }
      return gate.promise
    })

    await harness.controller.refreshRequestRecords({ force: true })
    const pending = harness.controller.refreshRequestRecords({ force: true, silent: false })

    expect(harness.state.requestRecords.loading).toBe(true)

    gate.resolve({ status: 200, body: { data: [recordSummary('record-1')] } })
    await pending

    expect(harness.state.requestRecords.loading).toBe(false)
  })

  it('keeps background refresh failures quiet', async () => {
    let requestCount = 0
    const harness = createHarness(() => {
      requestCount += 1
      if (requestCount === 1) return { status: 200, body: { data: [recordSummary('record-1')] } }
      return { status: 500, body: {} }
    })

    await harness.controller.refreshRequestRecords({ force: true })
    await harness.controller.refreshRequestRecords({ force: true, silent: true })

    expect(harness.toasts).toHaveLength(0)
    expect(harness.state.requestRecords.error).toBe('HTTP 500')
    expect(harness.state.requestRecords.items).toHaveLength(1)
  })

  it('打开面板只拉一次，不保留后台定时器', async () => {
    vi.useFakeTimers()
    const harness = createHarness(() => ({ status: 200, body: { data: [recordSummary('record-1')] } }))

    harness.controller.startRequestRecordsAutoRefresh()
    harness.controller.startRequestRecordsAutoRefresh()
    await vi.advanceTimersByTimeAsync(0)
    expect(harness.requests).toHaveLength(1)

    // 没有任何周期请求：后台定时器已退役。
    await vi.advanceTimersByTimeAsync(60_000)
    expect(harness.requests).toHaveLength(1)

    harness.controller.stopRequestRecordsAutoRefresh()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(harness.requests).toHaveLength(1)
  })
})
