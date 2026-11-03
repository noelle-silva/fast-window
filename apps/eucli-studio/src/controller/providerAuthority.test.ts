import { describe, expect, it, vi } from 'vitest'
import { createProviderAuthorityReader } from './providerAuthority'

describe('供应商权威读取', () => {
  it('按实体地址 GET 并返回 body', async () => {
    const netRequest = vi.fn(async () => ({ status: 200, body: { id: 'p1', name: '主供应商' } }))
    const readProvider = createProviderAuthorityReader(netRequest)

    await expect(readProvider('p1')).resolves.toEqual({ id: 'p1', name: '主供应商' })
    expect(netRequest).toHaveBeenCalledWith({ method: 'GET', path: '/api/providers/p1' })
  })

  it('404 映射为 null（实体确定不存在）', async () => {
    const error = Object.assign(new Error('not found'), { details: { statusCode: 404 } })
    const readProvider = createProviderAuthorityReader(async () => { throw error })

    await expect(readProvider('p1')).resolves.toBeNull()
  })

  it('业务错误码 NOT_FOUND 同样映射为 null', async () => {
    const error = Object.assign(new Error('not found'), { details: { json: { error: { code: 'NOT_FOUND' } } } })
    const readProvider = createProviderAuthorityReader(async () => { throw error })

    await expect(readProvider('p1')).resolves.toBeNull()
  })

  it('后端实际的 provider.not_found 错误码同样映射为 null', async () => {
    const error = Object.assign(new Error('provider not found'), { details: { json: { error: { code: 'provider.not_found' } } } })
    const readProvider = createProviderAuthorityReader(async () => { throw error })

    await expect(readProvider('p1')).resolves.toBeNull()
  })

  it('其他错误原样抛出，交给上层标记结果未确认', async () => {
    const error = new Error('连接断开')
    const readProvider = createProviderAuthorityReader(async () => { throw error })

    await expect(readProvider('p1')).rejects.toBe(error)
  })

  it('非 2xx 响应状态视为读取失败', async () => {
    const readProvider = createProviderAuthorityReader(async () => ({ status: 500, body: null }))

    await expect(readProvider('p1')).rejects.toThrow('读取供应商失败：HTTP 500')
  })
})
