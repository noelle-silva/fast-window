import { describe, expect, it, vi } from 'vitest'
import { updateRoleSessionMessage } from './ebRoleSession'

describe('updateRoleSessionMessage 保存消息部件', () => {
  it('保存时带上思维链，不丢', async () => {
    const netRequest = vi.fn(async (_req: any) => ({ body: { id: 'm1' } }))
    await updateRoleSessionMessage(netRequest as any, {
      roleId: 'r1',
      sessionId: 's1',
      messageId: 'm1',
      content: '正文',
      parts: [
        { id: 'p1', type: 'text', text: '正文' },
        {
          id: 'p2',
          type: 'reasoning',
          text: '思考内容',
          source: 'model',
          signature: 'sig',
          data: 'blob',
          durationMs: 1200,
        },
      ],
    })

    expect(netRequest).toHaveBeenCalledTimes(1)
    const request = netRequest.mock.calls[0][0] as any
    expect(request.method).toBe('PATCH')
    expect(request.path).toBe('/api/roles/r1/sessions/s1/messages/m1')
    expect(request.body.content).toBe('正文')
    expect(request.body.parts).toEqual([
      { id: 'p1', type: 'text', text: '正文' },
      { id: 'p2', type: 'reasoning', text: '思考内容', source: 'model', signature: 'sig', data: 'blob', durationMs: 1200 },
    ])
  })

  it('丢弃没有 id 或类型未知的部件', async () => {
    const netRequest = vi.fn(async (_req: any) => ({ body: {} }))
    await updateRoleSessionMessage(netRequest as any, {
      roleId: 'r1',
      sessionId: 's1',
      messageId: 'm1',
      parts: [
        { id: '', type: 'reasoning', text: '无 id' },
        { id: 'p1', type: 'unknown', text: '未知类型' },
        { id: 'p2', type: 'reasoning', text: '保留' },
      ],
    })
    const request = netRequest.mock.calls[0][0] as any
    expect(request.body.parts).toEqual([{ id: 'p2', type: 'reasoning', text: '保留', source: '', signature: '', data: '' }])
  })
})
