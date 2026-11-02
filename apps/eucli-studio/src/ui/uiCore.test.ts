import { describe, expect, it, vi } from 'vitest'
import { createUiCore } from './uiCore'
import { GLOBAL_REFRESH_SCOPE, refreshScopes } from '../domain/uiRefreshScope'

describe('uiCore 刷新内核契约', () => {
  it('emit 只通知全局订阅者，不惊动范围订阅者', () => {
    const core = createUiCore()
    const globalFn = vi.fn()
    const scopedFn = vi.fn()
    core.subscribe(globalFn)
    core.subscribeScope(refreshScopes.settings(), scopedFn)

    core.emit()

    expect(globalFn).toHaveBeenCalledTimes(1)
    expect(scopedFn).not.toHaveBeenCalled()
    expect(core.getVer()).toBe(1)
  })

  it('emitScope 只通知对应范围，且不增加全局版本', () => {
    const core = createUiCore()
    const settings = refreshScopes.settings()
    const navigation = refreshScopes.navigation()
    const settingsFn = vi.fn()
    const navigationFn = vi.fn()
    core.subscribeScope(settings, settingsFn)
    core.subscribeScope(navigation, navigationFn)

    core.emitScope(settings)

    expect(settingsFn).toHaveBeenCalledTimes(1)
    expect(navigationFn).not.toHaveBeenCalled()
    expect(core.getVer()).toBe(0)
    expect(core.getScopeVer(settings)).toBeGreaterThan(0)
    expect(core.getScopeVer(navigation)).toBe(0)
  })

  it('emitScopes 对同一地址只通知一次，并同时覆盖多个地址', () => {
    const core = createUiCore()
    const session = refreshScopes.session('role', 'role-1', 'chat-1')
    const composer = refreshScopes.composer()
    const sessionFn = vi.fn()
    const composerFn = vi.fn()
    const globalFn = vi.fn()
    core.subscribeScope(session, sessionFn)
    core.subscribeScope(composer, composerFn)
    core.subscribe(globalFn)

    core.emitScopes([session, session, composer, session])

    expect(sessionFn).toHaveBeenCalledTimes(1)
    expect(composerFn).toHaveBeenCalledTimes(1)
    expect(globalFn).not.toHaveBeenCalled()
    expect(core.getVer()).toBe(0)
    expect(core.getScopeVer(session)).toBeGreaterThan(0)
    expect(core.getScopeVer(composer)).toBeGreaterThan(0)
  })

  it('emitScopes 内 global 与空地址归一到全局通道且只通知一次', () => {
    const core = createUiCore()
    const globalFn = vi.fn()
    core.subscribe(globalFn)

    core.emitScopes(['', 'global', '  ', GLOBAL_REFRESH_SCOPE])

    expect(globalFn).toHaveBeenCalledTimes(1)
    expect(core.getVer()).toBe(1)
  })

  it('emitScope 的空地址与 global 地址一律走全局通道', () => {
    const core = createUiCore()
    const globalFn = vi.fn()
    const scopedGlobalFn = vi.fn()
    core.subscribe(globalFn)
    core.subscribeScope('', scopedGlobalFn)

    core.emitScope('')
    core.emitScope(` ${GLOBAL_REFRESH_SCOPE} `)

    expect(globalFn).toHaveBeenCalledTimes(2)
    expect(scopedGlobalFn).toHaveBeenCalledTimes(2)
    expect(core.getVer()).toBe(2)
    expect(core.getScopeVer('')).toBe(core.getVer())
    expect(core.getScopeVer(GLOBAL_REFRESH_SCOPE)).toBe(core.getVer())
  })

  it('未知 scope 版本为 0', () => {
    const core = createUiCore()

    expect(core.getScopeVer(refreshScopes.entities('roles'))).toBe(0)
  })

  it('取消订阅后不再收到通知', () => {
    const core = createUiCore()
    const scope = refreshScopes.uiShell('sidebar')
    const fn = vi.fn()
    const off = core.subscribeScope(scope, fn)

    core.emitScope(scope)
    off()
    core.emitScope(scope)

    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('scope 版本条目回收后版本仍保持全局单调', () => {
    const core = createUiCore()
    const scope = refreshScopes.chatList('group', 'group-1')
    const off = core.subscribeScope(scope, () => {})

    core.emitScope(scope)
    const first = core.getScopeVer(scope)
    expect(first).toBeGreaterThan(0)

    off()
    expect(core.getScopeVer(scope)).toBe(0)

    core.subscribeScope(scope, () => {})
    core.emitScope(scope)
    expect(core.getScopeVer(scope)).toBeGreaterThan(first)
  })

  it('订阅者异常走错误出口，且不阻断同一范围的其他订阅者', () => {
    const onSubscriberError = vi.fn()
    const core = createUiCore({ onSubscriberError })
    const scope = refreshScopes.settings()
    const broken = vi.fn(() => {
      throw new Error('boom')
    })
    const healthy = vi.fn()
    core.subscribeScope(scope, broken)
    core.subscribeScope(scope, healthy)

    core.emitScope(scope)

    expect(healthy).toHaveBeenCalledTimes(1)
    expect(onSubscriberError).toHaveBeenCalledTimes(1)
    const [error, info] = onSubscriberError.mock.calls[0]
    expect((error as Error).message).toBe('boom')
    expect(info).toEqual({ source: 'subscriber', scope })
  })

  it('全局订阅者异常同样上报，且不阻断其他全局订阅者', () => {
    const onSubscriberError = vi.fn()
    const core = createUiCore({ onSubscriberError })
    const broken = vi.fn(() => {
      throw new Error('global-boom')
    })
    const healthy = vi.fn()
    core.subscribe(broken)
    core.subscribe(healthy)

    core.emit()

    expect(healthy).toHaveBeenCalledTimes(1)
    expect(onSubscriberError).toHaveBeenCalledTimes(1)
    const [, info] = onSubscriberError.mock.calls[0]
    expect(info).toEqual({ source: 'subscriber', scope: GLOBAL_REFRESH_SCOPE })
  })

  it('dispose 清空订阅与版本，之后通知不再到达旧订阅者', () => {
    const core = createUiCore()
    const scope = refreshScopes.navigation()
    const globalFn = vi.fn()
    const scopedFn = vi.fn()
    core.subscribe(globalFn)
    core.subscribeScope(scope, scopedFn)

    core.dispose()
    core.emit()
    core.emitScope(scope)

    expect(globalFn).not.toHaveBeenCalled()
    expect(scopedFn).not.toHaveBeenCalled()
    expect(core.getScopeVer(scope)).toBe(0)
  })
})
