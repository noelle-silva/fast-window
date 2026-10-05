// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { deleteEntityThenRemoveRef } from './useFavoritesEntityActions'

describe('deleteEntityThenRemoveRef', () => {
  it('removes the ref only after the entity deletion resolves', async () => {
    const order: string[] = []
    let resolveDelete!: (deleted: boolean) => void
    const pending = new Promise<boolean>(resolve => {
      resolveDelete = resolve
    })

    deleteEntityThenRemoveRef({
      removeRefId: 'ref-1',
      deleteEntity: () => {
        order.push('delete')
        return pending
      },
      removeRef: refId => order.push(`remove:${refId}`),
    })

    expect(order).toEqual(['delete'])
    resolveDelete(true)
    await pending
    await Promise.resolve()
    expect(order).toEqual(['delete', 'remove:ref-1'])
  })

  it('leaves the ref untouched when deletion fails or is canceled', async () => {
    const removeRef = vi.fn()
    deleteEntityThenRemoveRef({ removeRefId: 'ref-1', deleteEntity: () => Promise.resolve(false), removeRef })
    await Promise.resolve()
    await Promise.resolve()
    expect(removeRef).not.toHaveBeenCalled()
  })

  it('does not touch any ref for a plain entity delete', async () => {
    const removeRef = vi.fn()
    deleteEntityThenRemoveRef({ removeRefId: '', deleteEntity: () => true, removeRef })
    await Promise.resolve()
    await Promise.resolve()
    expect(removeRef).not.toHaveBeenCalled()
  })

  it('handles a synchronous boolean result', async () => {
    const removeRef = vi.fn()
    deleteEntityThenRemoveRef({ removeRefId: 'ref-1', deleteEntity: () => true, removeRef })
    await Promise.resolve()
    await Promise.resolve()
    expect(removeRef).toHaveBeenCalledWith('ref-1')
  })
})
