import { describe, expect, it } from 'vitest'
import { createChatSettingsSaveQueue, chatSettingsActionLabels } from './chatSettingsSaveQueue'
import { chatSettingsTargetKey } from './chatSessionTarget'

function makeTarget(sessionId = 's-1', targetId = 'role-1', kind: 'role' | 'group' | 'workspace' = 'role') {
  return {
    kind,
    targetId,
    roleId: kind === 'group' ? '' : targetId,
    groupId: kind === 'group' ? targetId : '',
    workspaceId: kind === 'workspace' ? targetId : '',
    sessionId,
    chat: { id: sessionId },
  }
}

function deferred<T = void>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function createHarness(initialTarget = makeTarget()) {
  const savingByTarget: Record<string, any> = {}
  const errors: string[] = []
  let disposed = false
  let current: any = initialTarget
  let activeTarget = true
  const queue = createChatSettingsSaveQueue({
    getSavingByTarget: () => savingByTarget,
    resetSavingByTarget: () => { for (const key of Object.keys(savingByTarget)) delete savingByTarget[key] },
    captureCurrentTarget: () => current,
    isActiveTarget: () => activeTarget,
    isDisposed: () => disposed,
    onStateChanged: () => {},
    onError: (message: string) => { errors.push(message) },
  })
  return {
    queue,
    savingByTarget,
    errors,
    setCurrent: (value: any) => { current = value },
    setActiveTarget: (value: boolean) => { activeTarget = value },
    setDisposed: (value: boolean) => { disposed = value },
  }
}

async function waitTick() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('chat settings save queue', () => {
  it('serializes saves per target: a queued action waits for the running action', async () => {
    const harness = createHarness()
    const target = makeTarget()
    const firstGate = deferred()
    const order: string[] = []
    const first = harness.queue.runSave(target, 'model', { modelOverride: 'A' }, async () => {
      order.push('model')
      await firstGate.promise
    }, '失败')
    const second = harness.queue.runSave(target, 'reasoning', { reasoningEffort: 'high' }, async () => {
      order.push('reasoning')
    }, '失败')
    await waitTick()
    expect(order).toEqual(['model'])
    firstGate.resolve()
    await Promise.all([first, second])
    expect(order).toEqual(['model', 'reasoning'])
  })

  it('does not block different targets from each other', async () => {
    const harness = createHarness()
    const gateA = deferred()
    const gateB = deferred()
    const started: string[] = []
    const runA = harness.queue.runSave(makeTarget('s-a', 'role-a'), 'model', { modelOverride: 'A' }, async () => {
      started.push('a')
      await gateA.promise
    }, '失败')
    const runB = harness.queue.runSave(makeTarget('s-b', 'role-b'), 'model', { modelOverride: 'B' }, async () => {
      started.push('b')
      await gateB.promise
    }, '失败')
    await waitTick()
    expect(started).toContain('a')
    expect(started).toContain('b')
    gateA.resolve()
    gateB.resolve()
    await Promise.all([runA, runB])
  })

  it('dedupes a repeated click with the same action and value, even with a fresh object', async () => {
    const harness = createHarness()
    const target = makeTarget()
    let workCalls = 0
    const gate = deferred()
    const first = harness.queue.runSave(target, 'model', { modelOverride: { kind: 'provider', providerId: 'p', groupId: '', modelId: 'm' } }, async () => {
      workCalls++
      await gate.promise
    }, '失败')
    const second = harness.queue.runSave(target, 'model', { modelOverride: { kind: 'provider', providerId: 'p', groupId: '', modelId: 'm' } }, async () => {
      workCalls++
    }, '失败')
    expect(await second).toBe(false)
    await waitTick()
    expect(workCalls).toBe(1)
    gate.resolve()
    await first
    expect(workCalls).toBe(1)
  })

  it('does not dedupe different values of the same action: they are serialized, and the tail wins', async () => {
    const harness = createHarness()
    const target = makeTarget()
    const gate = deferred()
    const order: any[] = []
    const first = harness.queue.runSave(target, 'model', { modelOverride: 'A' }, async () => {
      order.push('A')
      await gate.promise
    }, '失败')
    const second = harness.queue.runSave(target, 'model', { modelOverride: 'B' }, async () => {
      order.push('B')
    }, '失败')
    await waitTick()
    expect(order).toEqual(['A'])
    gate.resolve()
    await Promise.all([first, second])
    expect(order).toEqual(['A', 'B'])
  })

  it('tracks saving status exactly: filled on start, replaced between chained saves, emptied at the end', async () => {
    const harness = createHarness()
    const target = makeTarget()
    const key = chatSettingsTargetKey(target)
    const gateA = deferred()
    const gateB = deferred()
    const runA = harness.queue.runSave(target, 'model', { modelOverride: 'A' }, async () => {
      await gateA.promise
    }, '失败')
    const runB = harness.queue.runSave(target, 'reasoning', { reasoningEffort: 'high' }, async () => {
      await gateB.promise
    }, '失败')
    await waitTick()
    const firstStatus: any = harness.savingByTarget[key]
    expect(firstStatus).toBeTruthy()
    expect(firstStatus.action).toBe('model')
    expect(firstStatus.actionLabel).toBe(chatSettingsActionLabels.model)
    expect(chatSettingsTargetKey(firstStatus)).toBe(key)
    gateA.resolve()
    await runA
    await waitTick()
    const secondStatus: any = harness.savingByTarget[key]
    expect(secondStatus).toBeTruthy()
    expect(secondStatus.action).toBe('reasoning')
    gateB.resolve()
    await runB
    expect(harness.savingByTarget[key]).toBeUndefined()
  })

  it('cleans state after a failing save and still runs the next queued save', async () => {
    const harness = createHarness()
    const target = makeTarget()
    const gate = deferred()
    const failFirst: Promise<'saved' | false> = harness.queue.runSave(target, 'model', { modelOverride: 'A' }, async () => {
      await gate.promise
      throw new Error('业务端拒绝')
    }, '当前会话临时模型保存失败')
    const second = harness.queue.runSave(target, 'reasoning', { reasoningEffort: 'high' }, async () => {}, '失败')
    gate.resolve()
    await expect(failFirst).resolves.toBe(false)
    await second
    expect(harness.errors).toEqual(['业务端拒绝'])
    expect(harness.savingByTarget[chatSettingsTargetKey(target)]).toBeUndefined()
  })

  it('does not toast errors for a target that is no longer active', async () => {
    const harness = createHarness()
    const target = makeTarget()
    const gate = deferred()
    const run = harness.queue.runSave(target, 'model', { modelOverride: 'A' }, async () => {
      await gate.promise
      throw new Error('失败原因')
    }, '失败')
    harness.setActiveTarget(false)
    gate.resolve()
    await expect(run).resolves.toBe(false)
    expect(harness.errors).toEqual([])
  })

  it('waitCurrentTargetSave waits for chained saves without missing or looping', async () => {
    const harness = createHarness()
    const target = makeTarget()
    const gate = deferred()
    let workCalls = 0
    const runA = harness.queue.runSave(target, 'model', { modelOverride: 'A' }, async () => {
      workCalls++
      await gate.promise
    }, '失败')
    const waiting = harness.queue.waitCurrentTargetSave()
    const runB = harness.queue.runSave(target, 'reasoning', { reasoningEffort: 'low' }, async () => {
      workCalls++
    }, '失败')
    gate.resolve()
    await runA
    await expect(waiting).resolves.toBeUndefined()
    expect(workCalls).toBe(2)
    await runB
  })

  it('waitCurrentTargetSave finishes immediately when nothing is in flight', async () => {
    const harness = createHarness()
    const target = makeTarget()
    await expect(harness.queue.waitCurrentTargetSave()).resolves.toBeUndefined()
    expect(harness.savingByTarget[chatSettingsTargetKey(target)]).toBeUndefined()
  })

  it('waitCurrentTargetSave does not hang after dispose', async () => {
    const harness = createHarness()
    const target = makeTarget()
    const gate = deferred()
    const run = harness.queue.runSave(target, 'model', { modelOverride: 'A' }, async () => {
      await gate.promise
    }, '失败')
    const waiting = harness.queue.waitCurrentTargetSave()
    const writeBack = { value: false }
    harness.setDisposed(true)
    harness.queue.abort()
    gate.resolve()
    await expect(run).resolves.toBe(false)
    await expect(waiting).resolves.toBeUndefined()
    expect(writeBack.value).toBe(false)
  })

  it('abort clears saving states and lets in-flight work write nothing back', async () => {
    const harness = createHarness()
    const target = makeTarget()
    const gate = deferred()
    let wroteBack = 0
    const run = harness.queue.runSave(target, 'model', { modelOverride: 'A' }, async (isCurrent) => {
      await gate.promise
      if (isCurrent()) wroteBack++
    }, '失败')
    await waitTick()
    expect(harness.savingByTarget[chatSettingsTargetKey(target)]).toBeTruthy()
    harness.queue.abort()
    expect(Object.keys(harness.savingByTarget)).toHaveLength(0)
    gate.resolve()
    await expect(run).resolves.toBe(false)
    expect(wroteBack).toBe(0)
  })

  it('isTargetActionPending only reports the same target with the same action and clears afterwards', async () => {
    const harness = createHarness()
    const target = makeTarget()
    const other = makeTarget('s-x', 'role-x')
    const gate = deferred()
    const run = harness.queue.runSave(target, 'model', { modelOverride: 'A' }, async () => {
      await gate.promise
    }, '失败')
    await waitTick()
    expect(harness.queue.isTargetActionPending(target, 'model')).toBe(true)
    expect(harness.queue.isTargetActionPending(target, 'reasoning')).toBe(false)
    expect(harness.queue.isTargetActionPending(other, 'model')).toBe(false)
    gate.resolve()
    await run
    expect(harness.queue.isTargetActionPending(target, 'model')).toBe(false)
  })

  it('reports pending for a queued action before it starts running', async () => {
    const harness = createHarness()
    const target = makeTarget()
    const gate = deferred()
    const runA = harness.queue.runSave(target, 'model', { modelOverride: 'A' }, async () => {
      await gate.promise
    }, '失败')
    const runB = harness.queue.runSave(target, 'model', { modelOverride: 'B' }, async () => {}, '失败')
    expect(harness.queue.isTargetActionPending(target, 'model')).toBe(true)
    gate.resolve()
    await Promise.all([runA, runB])
    expect(harness.queue.isTargetActionPending(target, 'model')).toBe(false)
  })

  it('rejects to the waiter when the current target save fails and the waiter handles it', async () => {
    const harness = createHarness()
    const target = makeTarget()
    const gate = deferred()
    const run = harness.queue.runSave(target, 'model', { modelOverride: 'A' }, async () => {
      await gate.promise
      throw new Error('保存失败')
    }, '失败')
    const waiting = harness.queue.waitCurrentTargetSave()
    gate.resolve()
    await expect(run).resolves.toBe(false)
    await expect(waiting).rejects.toThrow('保存失败')
    expect(harness.errors).toEqual([])
  })
})
