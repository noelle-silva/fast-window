import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_TIMEOUT_BUDGET,
  applyTimeoutBudget,
  currentTimeoutBudget,
  resetTimeoutBudgetForTests,
  resolveTimeoutMs,
  timeoutClassForNetRequest,
  timeoutForClass,
} from './timeoutBudget'

afterEach(() => {
  resetTimeoutBudgetForTests()
})

describe('三层超时预算的唯一来源', () => {
  it('默认预算与后端契约一致：交互 20s / 后台 45s', () => {
    expect(DEFAULT_TIMEOUT_BUDGET).toEqual({ interactionMs: 20_000, backgroundMs: 45_000 })
    expect(currentTimeoutBudget()).toEqual(DEFAULT_TIMEOUT_BUDGET)
  })

  it('healthCheck 签发的预算覆盖默认值', () => {
    applyTimeoutBudget({ interactionMs: 21_000, backgroundMs: 46_000 })
    expect(currentTimeoutBudget()).toEqual({ interactionMs: 21_000, backgroundMs: 46_000 })
    expect(timeoutForClass('interaction')).toBe(21_000)
    expect(timeoutForClass('background')).toBe(46_000)
  })

  it('预算倒挂快速失败，不静默修正', () => {
    expect(() => applyTimeoutBudget({ interactionMs: 50_000, backgroundMs: 40_000 })).toThrow(/倒挂/)
  })

  it('非法值回落到默认预算（服务端没给预算时）', () => {
    applyTimeoutBudget(undefined)
    expect(currentTimeoutBudget()).toEqual(DEFAULT_TIMEOUT_BUDGET)
    applyTimeoutBudget({ interactionMs: -1, backgroundMs: 'x' })
    expect(currentTimeoutBudget()).toEqual(DEFAULT_TIMEOUT_BUDGET)
  })
})

describe('超时类别推导', () => {
  it('读方法属于交互类', () => {
    for (const method of [
      'aiChat.storageGet',
      'aiChat.storageGetMany',
      'aiChat.session.get',
      'aiChat.session.window',
      'aiChat.session.graph',
      'aiChat.imageRead',
      'aiChat.healthCheck',
    ]) {
      expect(resolveTimeoutMs(method, undefined)).toBe(DEFAULT_TIMEOUT_BUDGET.interactionMs)
    }
  })

  it('写方法与命令属于后台类', () => {
    for (const method of ['aiChat.storageSet', 'aiChat.storageRemove', 'aiChat.imageWrite', 'aiChat.session.view', 'artifacts.import']) {
      expect(resolveTimeoutMs(method, undefined)).toBe(DEFAULT_TIMEOUT_BUDGET.backgroundMs)
    }
    // setActiveChat 是偏好命令但语义是交互（与 backend-go 的 methodTimeoutClass 一致）。
    expect(resolveTimeoutMs('aiChat.setActiveChat', undefined)).toBe(DEFAULT_TIMEOUT_BUDGET.interactionMs)
  })

  it('netRequest 按承载的 HTTP 方法/路径分流', () => {
    expect(timeoutClassForNetRequest({ method: 'GET', path: '/api/runs' })).toBe('interaction')
    expect(timeoutClassForNetRequest({ method: 'POST', path: '/api/runs' })).toBe('background')
    // 停止是用户点击的交互命令。
    expect(timeoutClassForNetRequest({ method: 'POST', path: '/api/runs/r1/cancel' })).toBe('interaction')
  })
})

describe('外层永不短于内层（倒挂结构性消失）', () => {
  it('调用方传入的任何 timeoutMs 都不改变预算', () => {
    // 写请求硬编码 15s：内层 studio 是 40s / box 30s，外层绝不能是 15s。
    expect(resolveTimeoutMs('aiChat.storageSet', undefined, 15_000)).toBe(DEFAULT_TIMEOUT_BUDGET.backgroundMs)
    // 透传写请求同理。
    expect(resolveTimeoutMs('aiChat.netRequest', { method: 'PUT', path: '/api/hook-prompts' }, 15_000))
      .toBe(DEFAULT_TIMEOUT_BUDGET.backgroundMs)
    // 更长的值同样不生效：预算由服务端签发，调用方无权延长。
    expect(resolveTimeoutMs('aiChat.storageSet', undefined, 90_000)).toBe(DEFAULT_TIMEOUT_BUDGET.backgroundMs)
    // 更短的值也不生效：否则前端会先放弃、studio/box 继续写。
    expect(resolveTimeoutMs('aiChat.storageGet', undefined, 5_000)).toBe(DEFAULT_TIMEOUT_BUDGET.interactionMs)
  })

  it('交互类与后台类都严格大于 studio 一跳', () => {
    // studio 一跳：交互 15s / 后台 40s（backend-go/timeout_budget.go）。
    expect(DEFAULT_TIMEOUT_BUDGET.interactionMs).toBeGreaterThan(15_000)
    expect(DEFAULT_TIMEOUT_BUDGET.backgroundMs).toBeGreaterThan(40_000)
  })
})
