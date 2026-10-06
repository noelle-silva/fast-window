import { describe, expect, it, vi } from 'vitest'
import type { BackgroundEvent } from '../gateway/backgroundClient'
import { createChangesService } from './changesService'

// 订阅出口：只把「changed」映射为变更事件，「reconnect」不进入变更回调；修订号从响应提取。
describe('createChangesService', () => {
  function makeBackground() {
    const listeners = new Set<(event: BackgroundEvent) => void>()
    const background = {
      invoke: vi.fn(async () => ({ revision: 7 })),
      subscribe: (handler: (event: BackgroundEvent) => void) => {
        listeners.add(handler)
        return () => listeners.delete(handler)
      },
      close: () => {},
    }
    const emit = (event: BackgroundEvent) => {
      for (const listener of listeners) listener(event)
    }
    return { background: background as any, emit }
  }

  it('只把 changed 事件交给变更回调，忽略 reconnect', () => {
    const { background, emit } = makeBackground()
    const service = createChangesService(background)
    const changes: any[] = []
    service.subscribeChanges(event => changes.push(event))
    emit({ type: 'changed', repoId: 'r1', kinds: ['notes'], revision: 3 })
    emit({ type: 'reconnect' })
    expect(changes).toEqual([{ repoId: 'r1', kinds: ['notes'], revision: 3 }])
  })

  it('reconnect 只交给重连回调', () => {
    const { background, emit } = makeBackground()
    const service = createChangesService(background)
    const reconnects: number[] = []
    const changes: any[] = []
    service.subscribeReconnect(() => reconnects.push(1))
    service.subscribeChanges(event => changes.push(event))
    emit({ type: 'reconnect' })
    emit({ type: 'changed', repoId: 'r1', kinds: ['assets'], revision: 1 })
    expect(reconnects).toEqual([1])
    expect(changes).toEqual([{ repoId: 'r1', kinds: ['assets'], revision: 1 }])
  })

  it('revision 返回后端修订号', async () => {
    const { background } = makeBackground()
    const service = createChangesService(background)
    await expect(service.revision('library')).resolves.toBe(7)
  })
})
