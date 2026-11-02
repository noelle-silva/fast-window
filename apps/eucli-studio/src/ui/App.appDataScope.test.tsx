// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { refreshScopes } from '../domain/uiRefreshScope'
import { createUiCore } from './uiCore'
import { useScopedUiVersion } from './hooks/useScopedUiVersion'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

// 与 App 根相同的取数方式：直接读 controller.getState()，
// 只订阅 appData 地址。这里验证该地址能驱动使用方重渲染，
// 而全局 emit 不再穿透（App 根没有全局兜底）。
function AppDataScopeHost(props: { controller: any; renderRef: React.MutableRefObject<number> }) {
  const s = props.controller.getState()
  useScopedUiVersion(props.controller, refreshScopes.appData())
  props.renderRef.current += 1
  return <div data-title={String(s?.data?.title || '')} />
}

describe('App appData 订阅', () => {
  let host: HTMLDivElement | null = null
  let root: any = null

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    if (root) {
      act(() => root.unmount())
      root = null
    }
    host?.remove()
    host = null
  })

  it('appData 推进时重渲染并读到最新数据，全局 emit 不再兜底', () => {
    const uiCore = createUiCore()
    const state: any = { loading: true, data: null }
    const controller = {
      getState: () => state,
      getScopeVer: (scope: string) => uiCore.getScopeVer(scope),
      subscribeScope: (scope: string, fn: () => void) => uiCore.subscribeScope(scope, fn),
    }
    const renderRef = { current: 0 }

    act(() => {
      root.render(<AppDataScopeHost controller={controller} renderRef={renderRef} />)
    })
    expect(renderRef.current).toBe(1)

    act(() => {
      state.loading = false
      state.data = { title: '启动完成' }
      uiCore.emit()
    })
    expect(renderRef.current).toBe(1)
    expect(host!.querySelector('[data-title]')?.getAttribute('data-title')).toBe('')

    act(() => {
      uiCore.emitScope(refreshScopes.appData())
    })
    expect(renderRef.current).toBe(2)
    expect(uiCore.getVer()).toBe(1)
    expect(host!.querySelector('[data-title]')?.getAttribute('data-title')).toBe('启动完成')
  })
})
