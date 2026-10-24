import { describe, expect, it, vi } from 'vitest'
import { createAiServices } from './aiServices'

describe('AI 微服务工作区会话参数', () => {
  it('生成工作区会话标题时独立传递 workspaceId 与 roleId', async () => {
    const netRequest = vi.fn(async () => ({ status: 200, body: { title: '新标题' } }))
    const services = createAiServices({ netRequest })

    await services.aiGenerateChatTitle('role-1', 'session-1', 'workspace-1')

    expect(netRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: 'POST',
      path: '/api/assist/chat-title',
      body: { roleId: 'role-1', sessionId: 'session-1', workspaceId: 'workspace-1' },
    }))
  })

  it('修复工作区会话 Mermaid 时独立传递 workspaceId 与 roleId', async () => {
    const netRequest = vi.fn(async () => ({ status: 200, body: { mermaidSource: 'graph TD\nA-->B' } }))
    const services = createAiServices({ netRequest })

    await services.aiFixMermaidInMessage('role-1', 'session-1', 'message-1', 'graph TD\nA-->C', '', 'workspace-1')

    expect(netRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: 'POST',
      path: '/api/assist/mermaid-fix',
      body: expect.objectContaining({ workspaceId: 'workspace-1', roleId: 'role-1', sessionId: 'session-1' }),
    }))
  })

  it('角色会话不携带 workspaceId', async () => {
    const netRequest = vi.fn(async () => ({ status: 200, body: { title: '新标题' } }))
    const services = createAiServices({ netRequest })

    await services.aiGenerateChatTitle('role-1', 'session-1')

    const request = (netRequest.mock.calls[0] as any[])[0]
    expect(request.body).toEqual({ roleId: 'role-1', sessionId: 'session-1' })
  })
})
