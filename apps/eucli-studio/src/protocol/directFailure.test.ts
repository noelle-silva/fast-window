import { describe, expect, it } from 'vitest'
import { AI_CHAT_DIRECT_METHOD } from './aiChatProtocol'
import {
  DIRECT_FAILURE,
  DirectFailure,
  isDirectFailure,
  keepsPromiseAfterInteractionTimeout,
  replayClassFor,
} from './directFailure'

describe('DirectFailure 四态', () => {
  it('每种失败都有稳定的 code 与方法名', () => {
    for (const kind of ['timeout', 'indeterminate', 'reconnectedUnknown', 'transport'] as const) {
      const failure = new DirectFailure(kind, 'aiChat.storageSet', 'non-idempotent')
      expect(failure.kind).toBe(kind)
      expect(failure.code).toBe(DIRECT_FAILURE[kind])
      expect(failure.method).toBe('aiChat.storageSet')
      expect(failure.message).toContain('aiChat.storageSet')
      expect(isDirectFailure(failure)).toBe(true)
    }
  })

  it('reconnected-unknown 使用协议约定的错误码', () => {
    expect(DIRECT_FAILURE.reconnectedUnknown).toBe('RECONNECTED_UNKNOWN')
  })

  it('普通 Error 不被误判为 DirectFailure', () => {
    expect(isDirectFailure(new Error('boom'))).toBe(false)
  })
})

describe('replay class 判定', () => {
  it('读方法属于 idempotent-read', () => {
    for (const method of [
      AI_CHAT_DIRECT_METHOD.healthCheck,
      AI_CHAT_DIRECT_METHOD.storageGet,
      AI_CHAT_DIRECT_METHOD.sessionIndexGet,
      AI_CHAT_DIRECT_METHOD.sessionGet,
      AI_CHAT_DIRECT_METHOD.sessionWindow,
      AI_CHAT_DIRECT_METHOD.sessionGraph,
      AI_CHAT_DIRECT_METHOD.storageGetMany,
    ]) {
      expect(replayClassFor(method)).toBe('idempotent-read')
    }
  })

  it('写方法与命令属于 non-idempotent', () => {
    for (const method of [
      AI_CHAT_DIRECT_METHOD.storageSet,
      AI_CHAT_DIRECT_METHOD.storageRemove,
      AI_CHAT_DIRECT_METHOD.setActiveChat,
      AI_CHAT_DIRECT_METHOD.sessionView,
      AI_CHAT_DIRECT_METHOD.imageWrite,
    ]) {
      expect(replayClassFor(method)).toBe('non-idempotent')
    }
  })

  it('netRequest 按承载的 HTTP 方法分流', () => {
    expect(replayClassFor(AI_CHAT_DIRECT_METHOD.netRequest, { method: 'GET', path: '/api/runs' })).toBe('idempotent-read')
    expect(replayClassFor(AI_CHAT_DIRECT_METHOD.netRequest, { method: 'POST', path: '/api/runs' })).toBe('non-idempotent')
    // 缺省视为读，与 HTTP 语义一致。
    expect(replayClassFor(AI_CHAT_DIRECT_METHOD.netRequest, { path: '/api/runs' })).toBe('idempotent-read')
  })

  it('未知方法按命令处理，绝不自动重放', () => {
    expect(replayClassFor('aiChat.unknownCommand')).toBe('non-idempotent')
  })
})

describe('交互超时后的 promise 处置', () => {
  it('只有读请求保留 promise 至自然完成', () => {
    expect(keepsPromiseAfterInteractionTimeout('idempotent-read')).toBe(true)
    expect(keepsPromiseAfterInteractionTimeout('non-idempotent')).toBe(false)
  })
})
