// @vitest-environment happy-dom
//
// 运行通知的扫描失效依据：
// 全表扫描只允许由「运行卡版本 / 数据引用」驱动；
// App 本地 UI 状态导致的重渲染不得重复扫描整份会话数据。
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { refreshScopes } from '../../domain/uiRefreshScope'
import { createUiCore } from '../uiCore'

const { collectSpy } = vi.hoisted(() => ({ collectSpy: vi.fn() }))

vi.mock('../chatSessionRunObservations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../chatSessionRunObservations')>()
  collectSpy.mockImplementation(actual.collectChatSessionRunObservations)
  return { ...actual, collectChatSessionRunObservations: collectSpy }
})

import { useSessionRunObservations } from './useSessionRunObservations'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const STATE_STUB = {}

function createData(status: string) {
  return {
    chatsByRole: {
      r1: {
        activeChatId: '',
        chats: [{ id: 'c1', status, runStatusChangedAt: 100 }],
        chatMetas: [],
      },
    },
    chatsByGroup: {},
    chatsByWorkspace: {},
  } as any
}

function Harness(props: {
  data: any
  activeChatId: string
  localTick: number
  apiRef: React.MutableRefObject<any>
  controller?: any
}) {
  props.apiRef.current = useSessionRunObservations({
    data: props.data,
    s: STATE_STUB,
    activeTargetKind: 'role',
    activeChatTargetId: 'r1',
    activeChatId: props.activeChatId,
    controller: props.controller,
  })
  return <div data-tick={props.localTick} />
}

describe('useSessionRunObservations', () => {
  let host: HTMLDivElement | null = null
  let root: any = null
  let apiRef: React.MutableRefObject<any> = { current: null }

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    apiRef = { current: null }
    collectSpy.mockClear()
  })

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root.unmount()
      })
      root = null
    }
    host?.remove()
    host = null
  })

  async function render(props: {
    data: any
    activeChatId?: string
    localTick?: number
    controller?: any
  }) {
    await act(async () => {
      root.render(
        <Harness
          data={props.data}
          activeChatId={props.activeChatId ?? ''}
          localTick={props.localTick ?? 0}
          apiRef={apiRef}
          controller={props.controller}
        />,
      )
    })
  }

  it('本地重渲染不重复扫描；数据引用变化时才扫描并产生终态通知', async () => {
    const data = createData('running')

    await render({ data })
    expect(collectSpy).toHaveBeenCalledTimes(1)
    expect(apiRef.current.chatSessionRunNotices).toEqual({})

    await render({ data, localTick: 1 })
    expect(collectSpy).toHaveBeenCalledTimes(1)

    const next = createData('completed')
    next.chatsByRole.r1.chats[0].runStatusChangedAt = 200
    await render({ data: next, localTick: 1 })

    expect(collectSpy).toHaveBeenCalledTimes(2)
    expect(apiRef.current.chatSessionRunNotices['role:r1:c1']).toEqual({ kind: 'completed', changedAt: 200 })
  })

  it('注入 controller 时由 runCards scope 驱动扫描，不依赖全局版本', async () => {
    const uiCore = createUiCore()
    const controller = {
      getScopeVer: (scope: string) => uiCore.getScopeVer(scope),
      subscribeScope: (scope: string, fn: () => void) => uiCore.subscribeScope(scope, fn),
    }
    const data = createData('running')

    await render({ data, controller })
    expect(collectSpy).toHaveBeenCalledTimes(1)

    data.chatsByRole.r1.chats[0].status = 'completed'
    data.chatsByRole.r1.chats[0].runStatusChangedAt = 200
    await act(async () => {
      uiCore.emitScope(refreshScopes.runCards())
    })

    expect(uiCore.getVer()).toBe(0)
    expect(collectSpy).toHaveBeenCalledTimes(2)
    expect(apiRef.current.chatSessionRunNotices['role:r1:c1']).toEqual({ kind: 'completed', changedAt: 200 })
  })

  it('切换到该会话时清除它的运行通知', async () => {
    const running = createData('running')

    await render({ data: running })
    const completed = createData('completed')
    await render({ data: completed })
    expect(apiRef.current.chatSessionRunNotices['role:r1:c1']).toBeTruthy()

    await render({ data: completed, activeChatId: 'c1' })
    expect(apiRef.current.chatSessionRunNotices['role:r1:c1']).toBeUndefined()
  })
})
