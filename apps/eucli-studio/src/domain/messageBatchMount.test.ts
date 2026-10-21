import { describe, expect, it } from 'vitest'
import { planMessageBatchMount } from './messageBatchMount'

function messages(count: number) {
  return Array.from({ length: count }, (_, index) => ({ id: `m-${index}` }))
}

describe('message batch mount plan', () => {
  it('keeps the latest five messages and groups older messages in tens from newest to oldest', () => {
    const plan = planMessageBatchMount(messages(37))

    expect(plan.anchorId).toBe('m-32')
    expect(plan.anchorIndex).toBe(32)
    expect(plan.batches.map((batch) => batch.ids)).toEqual([
      ['m-22', 'm-23', 'm-24', 'm-25', 'm-26', 'm-27', 'm-28', 'm-29', 'm-30', 'm-31'],
      ['m-12', 'm-13', 'm-14', 'm-15', 'm-16', 'm-17', 'm-18', 'm-19', 'm-20', 'm-21'],
      ['m-2', 'm-3', 'm-4', 'm-5', 'm-6', 'm-7', 'm-8', 'm-9', 'm-10', 'm-11'],
      ['m-0', 'm-1'],
    ])
  })

  it('keeps a short conversation fully visible without old batches', () => {
    const plan = planMessageBatchMount(messages(5))

    expect(plan.anchorId).toBe('m-0')
    expect(plan.anchorIndex).toBe(0)
    expect(plan.batches).toEqual([])
  })

  it('uses the provided batch shape', () => {
    const plan = planMessageBatchMount(messages(12), { initialSize: 2, batchSize: 3 })

    expect(plan.anchorId).toBe('m-10')
    expect(plan.batches.map((batch) => batch.ids)).toEqual([
      ['m-7', 'm-8', 'm-9'],
      ['m-4', 'm-5', 'm-6'],
      ['m-1', 'm-2', 'm-3'],
      ['m-0'],
    ])
  })

  it('handles an empty conversation', () => {
    expect(planMessageBatchMount([])).toEqual({ anchorId: '', anchorIndex: 0, batches: [] })
  })
})
