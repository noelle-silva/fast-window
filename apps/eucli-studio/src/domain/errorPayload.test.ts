import { describe, expect, it } from 'vitest'
import { collectErrorOrigins, normalizeErrorPayload, type ErrorPayload } from './errorPayload'

function payload(input: unknown): ErrorPayload {
  const normalized = normalizeErrorPayload(input)
  if (!normalized) throw new Error('payload should normalize')
  return normalized
}

describe('collectErrorOrigins', () => {
  it('returns the node itself when it carries no deeper reason', () => {
    const leaf = payload({ code: 'network.dns_failed', system: 'network-request-system', message: 'dns failed' })
    expect(collectErrorOrigins(leaf)).toEqual([leaf])
  })

  it('descends a single cause chain to the deepest origin', () => {
    const error = payload({
      code: 'runtime.run_failed',
      message: '运行失败',
      cause: { code: 'gateway.upstream_failed', message: '网关失败', cause: { code: 'provider.service_failed', message: '上游返回 429' } },
    })
    expect(collectErrorOrigins(error).map((item) => item.message)).toEqual(['上游返回 429'])
  })

  it('lists every parallel cause', () => {
    const error = payload({
      code: 'runtime.run_failed',
      message: '运行失败',
      causes: [
        { code: 'network.dns_failed', system: 'network-request-system', message: 'dns failed' },
        { code: 'provider.service_failed', message: 'upstream says no' },
      ],
    })
    expect(collectErrorOrigins(error).map((item) => item.message)).toEqual(['dns failed', 'upstream says no'])
  })

  it('collects origins across mixed cause and causes branches in order', () => {
    const error = payload({
      message: '请求失败',
      cause: {
        message: '重试耗尽',
        causes: [{ message: '第一条源头' }, { message: '第二条源头' }],
      },
      causes: [{ message: '第三条源头', cause: { message: '第三条的根' } }],
    })
    expect(collectErrorOrigins(error).map((item) => item.message)).toEqual(['第一条源头', '第二条源头', '第三条的根'])
  })
})
