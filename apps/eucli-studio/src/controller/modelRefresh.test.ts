import { describe, expect, it, vi } from 'vitest'
import { now } from '../core/utils'
import { createModelRefresh } from './modelRefresh'

type RefreshResponse = { status: number; body: any }

function createHarness(initialCache: any = { items: ['old-model'], fetchedAt: 0 }) {
  const provider = {
    id: 'provider-a',
    name: '主供应商',
    baseUrl: 'https://a.example/v1',
    modelsCache: initialCache,
  }
  const state: any = {
    models: { loading: false, error: '', items: [] },
  }
  const netRequest = vi.fn(async (_req: any): Promise<RefreshResponse> => ({
    status: 200,
    body: { data: [{ id: 'model-b' }, { id: 'model-a' }] },
  }))
  const persistProvider = vi.fn(async (_provider: any) => {})
  const emit = vi.fn()
  const showToast = vi.fn()
  const controller = createModelRefresh({
    getState: () => state,
    getProvider: (pid: string) => (pid === provider.id ? provider : null),
    netRequest,
    persistProvider,
    emit,
    showToast,
  })
  return { provider, state, netRequest, persistProvider, emit, showToast, controller }
}

describe('模型刷新持久化', () => {
  it('刷新成功时持久化一次，且落盘的是含新 modelsCache 的供应商', async () => {
    const harness = createHarness()

    await harness.controller.refreshModels('provider-a', true)

    expect(harness.netRequest).toHaveBeenCalledTimes(1)
    expect(harness.persistProvider).toHaveBeenCalledTimes(1)
    const saved = harness.persistProvider.mock.calls[0][0] as any
    expect(saved).toBe(harness.provider)
    expect(saved.modelsCache.items).toEqual(['model-a', 'model-b'])
    expect(saved.modelsCache.fetchedAt).toBeGreaterThan(0)
    expect(harness.state.models).toEqual({ loading: false, error: '', items: ['model-a', 'model-b'] })
    expect(harness.showToast).toHaveBeenCalledWith('模型已刷新（2）', { kind: 'success' })
    expect(harness.emit).toHaveBeenCalledTimes(2)
  })

  it('缓存命中时只回填列表，不请求也不持久化', async () => {
    const cache = { items: ['cached-model'], fetchedAt: now() }
    const harness = createHarness(cache)

    await harness.controller.refreshModels('provider-a', false)

    expect(harness.netRequest).not.toHaveBeenCalled()
    expect(harness.persistProvider).not.toHaveBeenCalled()
    expect(harness.state.models).toEqual({ loading: false, error: '', items: ['cached-model'] })
    expect(harness.emit).toHaveBeenCalledTimes(1)
  })

  it('刷新失败时不持久化，保留原缓存并提示错误', async () => {
    const harness = createHarness()
    harness.netRequest.mockRejectedValueOnce(new Error('network down'))

    await harness.controller.refreshModels('provider-a', true)

    expect(harness.persistProvider).not.toHaveBeenCalled()
    expect(harness.provider.modelsCache).toEqual({ items: ['old-model'], fetchedAt: 0 })
    expect(harness.state.models).toEqual({ loading: false, error: 'network down', items: [] })
    expect(harness.showToast).toHaveBeenCalledWith('network down', { kind: 'error' })
  })

  it('持久化失败时保留内存中的新模型，并明确提示保存失败', async () => {
    const harness = createHarness()
    harness.persistProvider.mockRejectedValueOnce(new Error('disk full'))

    await harness.controller.refreshModels('provider-a', true)

    expect(harness.persistProvider).toHaveBeenCalledTimes(1)
    expect(harness.provider.modelsCache.items).toEqual(['model-a', 'model-b'])
    expect(harness.state.models).toEqual({ loading: false, error: '', items: ['model-a', 'model-b'] })
    expect(harness.showToast).toHaveBeenCalledTimes(1)
    expect(harness.showToast.mock.calls[0][0]).toContain('模型已刷新（2），但保存失败')
    expect(harness.showToast.mock.calls[0][0]).toContain('disk full')
    expect(harness.showToast.mock.calls[0][0]).toContain('仅保留在内存')
    expect(harness.showToast.mock.calls[0][1]).toEqual({ kind: 'error' })
    expect(harness.emit).toHaveBeenCalledTimes(2)
  })
})
