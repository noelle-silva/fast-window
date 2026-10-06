// @vitest-environment jsdom
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ChangeEvent } from '../gateway/types'
import { ALL_CHANGE_KINDS, useExternalChangeSync } from './useExternalChangeSync'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type FakeGateway = {
  changes: {
    revision: () => Promise<number>
    subscribeChanges: (handler: (event: ChangeEvent) => void) => () => void
    subscribeReconnect: (handler: () => void) => () => void
  }
  setRevision: (value: number) => void
  emitChange: (event: ChangeEvent) => void
  emitReconnect: () => void
}

function makeGateway(initialRevision: number): FakeGateway {
  let revision = initialRevision
  const changeHandlers = new Set<(event: ChangeEvent) => void>()
  const reconnectHandlers = new Set<() => void>()
  return {
    changes: {
      revision: async () => revision,
      subscribeChanges: handler => {
        changeHandlers.add(handler)
        return () => changeHandlers.delete(handler)
      },
      subscribeReconnect: handler => {
        reconnectHandlers.add(handler)
        return () => reconnectHandlers.delete(handler)
      },
    },
    setRevision: value => {
      revision = value
    },
    emitChange: event => {
      for (const handler of changeHandlers) handler(event)
    },
    emitReconnect: () => {
      for (const handler of reconnectHandlers) handler()
    },
  }
}

function Harness(props: { gateway: FakeGateway; onChange: (kinds: string[]) => void }) {
  useExternalChangeSync({ gateway: props.gateway as any, repoId: 'r1', enabled: true, onChange: props.onChange })
  return null
}

describe('useExternalChangeSync', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('只让对应仓库的变更触发重载，其它仓库忽略', async () => {
    const gateway = makeGateway(0)
    const calls: string[][] = []
    await act(async () => {
      root.render(<Harness gateway={gateway} onChange={kinds => calls.push(kinds)} />)
    })
    await act(async () => {
      gateway.emitChange({ repoId: 'other', kinds: ['notes'], revision: 1 })
      gateway.emitChange({ repoId: 'r1', kinds: ['favorites'], revision: 2 })
    })
    expect(calls).toEqual([['favorites']])
  })

  it('重连后修订号不一致时按全类别重载', async () => {
    const gateway = makeGateway(3)
    const calls: string[][] = []
    await act(async () => {
      root.render(<Harness gateway={gateway} onChange={kinds => calls.push(kinds)} />)
    })
    // 初始化基线为 3；重连后修订号未变：不重载。
    await act(async () => {
      gateway.emitReconnect()
    })
    expect(calls).toEqual([])
    // 重连后修订号前进：说明断线期间漏掉通知，按全类别重载。
    gateway.setRevision(5)
    await act(async () => {
      gateway.emitReconnect()
    })
    expect(calls).toEqual([[...ALL_CHANGE_KINDS]])
  })

  it('收到变更后更新基线，重连修订号相同时不重载', async () => {
    const gateway = makeGateway(0)
    const calls: string[][] = []
    await act(async () => {
      root.render(<Harness gateway={gateway} onChange={kinds => calls.push(kinds)} />)
    })
    await act(async () => {
      gateway.setRevision(4)
      gateway.emitChange({ repoId: 'r1', kinds: ['notes'], revision: 4 })
    })
    expect(calls).toEqual([['notes']])
    await act(async () => {
      gateway.emitReconnect()
    })
    expect(calls).toEqual([['notes']])
  })
})
