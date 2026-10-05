// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { deleteEntityThenRemoveRefs } from './useFavoritesEntityActions'

describe('deleteEntityThenRemoveRefs', () => {
  it('removes refs only after the entity deletion resolves', async () => {
    const order: string[] = []
    let resolveDelete!: (deleted: boolean) => void
    const pending = new Promise<boolean>(resolve => {
      resolveDelete = resolve
    })

    deleteEntityThenRemoveRefs({
      refIds: ['ref-1', 'ref-2'],
      deleteEntity: () => {
        order.push('delete')
        return pending
      },
      removeRefs: refIds => order.push(`remove:${refIds.join(',')}`),
    })

    expect(order).toEqual(['delete'])
    resolveDelete(true)
    await pending
    await Promise.resolve()
    expect(order).toEqual(['delete', 'remove:ref-1,ref-2'])
  })

  it('leaves refs untouched when deletion fails or is canceled', async () => {
    const removeRefs = vi.fn()
    deleteEntityThenRemoveRefs({ refIds: ['ref-1'], deleteEntity: () => Promise.resolve(false), removeRefs })
    await Promise.resolve()
    await Promise.resolve()
    expect(removeRefs).not.toHaveBeenCalled()
  })

  it('does not touch any ref when there is nothing to remove', async () => {
    const removeRefs = vi.fn()
    deleteEntityThenRemoveRefs({ refIds: [], deleteEntity: () => true, removeRefs })
    await Promise.resolve()
    await Promise.resolve()
    expect(removeRefs).not.toHaveBeenCalled()
  })

  it('handles a synchronous boolean result', async () => {
    const removeRefs = vi.fn()
    deleteEntityThenRemoveRefs({ refIds: ['ref-1'], deleteEntity: () => true, removeRefs })
    await Promise.resolve()
    await Promise.resolve()
    expect(removeRefs).toHaveBeenCalledWith(['ref-1'])
  })
})
