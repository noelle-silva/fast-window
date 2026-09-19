import { afterEach, describe, expect, it, vi } from 'vitest'
import { createArtifactInstallTracker, type ArtifactInstallStateMap } from './artifactInstallTracker'
import type { ArtifactInstallState } from '../domain/release'

function state(id: string, status: string, phase = '', receivedBytes = 0, totalBytes = 0): ArtifactInstallState {
  return {
    operationId: 'op-' + id,
    artifact: { kind: 'tool', id },
    installed: false,
    currentVersion: '',
    targetVersion: '0.1.0',
    status,
    phase,
    progress: { receivedBytes, totalBytes },
    error: { code: '', phase: '', message: '' },
  }
}

function createHarness() {
  let states: ArtifactInstallStateMap = {}
  const terminals: Array<{ id: string; status: string }> = []
  const errors: string[] = []
  const loadState = vi.fn<(id: string) => Promise<ArtifactInstallState | null>>()
  const cancel = vi.fn<(id: string) => Promise<ArtifactInstallState | null>>()
  const loadOperations = vi.fn<() => Promise<ArtifactInstallState[]>>(async () => [])
  const tracker = createArtifactInstallTracker({
    loadState,
    cancel,
    loadOperations,
    getStates: () => states,
    setStates: (next) => {
      states = next
    },
    onTerminal: (id, value) => terminals.push({ id, status: value.status }),
    onError: (message) => errors.push(message),
  })
  return { tracker, getStates: () => states, terminals, errors, loadState, cancel, loadOperations }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('artifact install tracker', () => {
  it('polls a tracked running task until it reaches a terminal state', async () => {
    vi.useFakeTimers()
    const harness = createHarness()
    let calls = 0
    harness.loadState.mockImplementation(async (id) => {
      calls += 1
      if (calls >= 3) return state(id, 'active')
      return state(id, 'downloading', 'download', 50, 100)
    })

    harness.tracker.track('demo')
    await vi.advanceTimersByTimeAsync(0)
    expect(harness.getStates().demo.status).toBe('downloading')

    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(1000)

    expect(harness.getStates().demo.status).toBe('active')
    expect(harness.terminals).toEqual([{ id: 'demo', status: 'active' }])
  })

  it('stops polling after all tracked tasks leave the running set', async () => {
    vi.useFakeTimers()
    const harness = createHarness()
    harness.loadState.mockResolvedValue(state('demo', 'failed'))

    harness.tracker.track('demo')
    await vi.advanceTimersByTimeAsync(0)
    expect(harness.loadState).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(5000)
    expect(harness.loadState).toHaveBeenCalledTimes(1)
  })

  it('syncs batch operations and tracks the running ones', async () => {
    vi.useFakeTimers()
    const harness = createHarness()
    harness.loadOperations.mockResolvedValue([
      state('running-tool', 'downloading', 'download'),
      state('failed-tool', 'failed'),
    ])
    harness.loadState.mockResolvedValue(state('running-tool', 'active'))

    await harness.tracker.sync()
    expect(harness.getStates()['running-tool'].status).toBe('downloading')
    expect(harness.getStates()['failed-tool'].status).toBe('failed')
    expect(harness.terminals).toEqual([])

    await vi.advanceTimersByTimeAsync(1000)
    expect(harness.getStates()['running-tool'].status).toBe('active')
    expect(harness.terminals).toEqual([{ id: 'running-tool', status: 'active' }])
  })

  it('applies a cancelled terminal state and stops tracking', async () => {
    vi.useFakeTimers()
    const harness = createHarness()
    harness.loadState.mockResolvedValue(state('demo', 'downloading', 'download'))
    harness.cancel.mockResolvedValue(state('demo', 'cancelled', 'download'))

    harness.tracker.track('demo')
    await vi.advanceTimersByTimeAsync(0)
    const result = await harness.tracker.cancel('demo')

    expect(result?.status).toBe('cancelled')
    expect(harness.getStates().demo.status).toBe('cancelled')
    expect(harness.terminals).toEqual([{ id: 'demo', status: 'cancelled' }])

    await vi.advanceTimersByTimeAsync(3000)
    const callsAfterCancel = harness.loadState.mock.calls.length
    await vi.advanceTimersByTimeAsync(3000)
    expect(harness.loadState.mock.calls.length).toBe(callsAfterCancel)
  })

  it('reports an error when cancelling fails', async () => {
    const harness = createHarness()
    harness.cancel.mockRejectedValue(new Error('取消失败'))
    const result = await harness.tracker.cancel('demo')
    expect(result).toBeNull()
    expect(harness.errors).toEqual(['取消失败'])
  })
})
