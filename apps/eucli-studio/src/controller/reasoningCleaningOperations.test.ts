import { describe, expect, it, vi } from 'vitest'
import { createReasoningCleaningOperations } from './reasoningCleaningOperations'

function buildShared(options: { running?: boolean } = {}) {
  const target = {
    targetKind: 'role' as const,
    targetId: 'r1',
    roleId: 'r1',
    groupId: '',
    workspaceId: '',
    sessionId: 's1',
    chat: {
      id: 's1',
      updatedAt: 1,
      messages: [
        { id: 'm1', content: '正文甲', parts: [{ id: 'p1', type: 'reasoning', text: '先甲思考乙一下', signature: 'sig甲' }] },
        { id: 'm2', content: '甲正文', parts: [{ id: 'p2', type: 'text', text: '甲正文' }] },
        { id: 'm3', parts: [{ id: 'p3', type: 'reasoning', text: '没有命中' }] },
      ],
    },
  }
  const state: any = {
    loading: false,
    data: {},
    activeRunCards: options.running
      ? [{ kind: 'eb-role-run', runId: 'run1', roleId: 'r1', sessionId: 's1', status: 'running', createdAt: 1, updatedAt: 1 }]
      : [],
  }
  const deps: any = {
    getState: () => state,
    netRequest: vi.fn(async (_req: any) => ({ body: {} })),
    showToast: vi.fn(),
    render: vi.fn(),
  }
  const refreshTargetSession = vi.fn(async () => target.chat)
  const shared: any = {
    deps,
    activeTargetSessionMutationTarget: async () => target,
    refreshTargetSession,
  }
  return { shared, deps, target, refreshTargetSession }
}

describe('cleanSessionReasoning', () => {
  it('清洗会话里所有消息的思维链，只保存被改动的消息', async () => {
    const { shared, deps, refreshTargetSession } = buildShared()
    const ops = createReasoningCleaningOperations(shared)

    const ok = await ops.cleanSessionReasoning('甲\n乙')

    expect(ok).toBe(true)
    expect(deps.netRequest).toHaveBeenCalledTimes(1)
    const request = deps.netRequest.mock.calls[0][0] as any
    expect(request.path).toBe('/api/roles/r1/sessions/s1/messages/m1')
    const reasoning = request.body.parts.find((part: any) => part.type === 'reasoning')
    expect(reasoning.text).toBe('先思考一下')
    expect(reasoning.signature).toBe('sig甲')
    expect(refreshTargetSession).toHaveBeenCalledWith('role', 'r1', 's1', undefined, { activate: false })
  })

  it('没有命中的关键词时不保存', async () => {
    const { shared, deps } = buildShared()
    const ops = createReasoningCleaningOperations(shared)

    const ok = await ops.cleanSessionReasoning('不存在')

    expect(ok).toBe(false)
    expect(deps.netRequest).not.toHaveBeenCalled()
  })

  it('会话正在运行时拒绝清洗', async () => {
    const { shared, deps } = buildShared({ running: true })
    const ops = createReasoningCleaningOperations(shared)

    const ok = await ops.cleanSessionReasoning('甲')

    expect(ok).toBe(false)
    expect(deps.netRequest).not.toHaveBeenCalled()
    expect(deps.showToast).toHaveBeenCalledWith('会话正在运行，暂不能清洗思维链', { kind: 'error' })
  })

  it('跳过不能被编辑的消息，只清洗可编辑的消息', async () => {
    const { shared, deps } = buildShared()
    shared.activeTargetSessionMutationTarget = async () => ({
      targetKind: 'role',
      targetId: 'r1',
      roleId: 'r1',
      groupId: '',
      workspaceId: '',
      sessionId: 's1',
      chat: {
        id: 's1',
        updatedAt: 1,
        messages: [
          { id: 'm1', parts: [{ id: 'p1', type: 'reasoning', text: '甲思考' }] },
          { id: 'sys', type: 'system_control', control: { kind: 'compression_summary' }, parts: [{ id: 'p2', type: 'reasoning', text: '甲摘要' }] },
        ],
      },
    })
    const ops = createReasoningCleaningOperations(shared)

    const ok = await ops.cleanSessionReasoning('甲')

    expect(ok).toBe(true)
    expect(deps.netRequest).toHaveBeenCalledTimes(1)
    expect((deps.netRequest.mock.calls[0][0] as any).path).toBe('/api/roles/r1/sessions/s1/messages/m1')
  })
})

describe('cleanMessageReasoning', () => {
  it('只清洗指定消息的思维链', async () => {
    const { shared, deps, refreshTargetSession } = buildShared()
    const ops = createReasoningCleaningOperations(shared)

    const ok = await ops.cleanMessageReasoning('m1', '甲')

    expect(ok).toBe(true)
    expect(deps.netRequest).toHaveBeenCalledTimes(1)
    const request = deps.netRequest.mock.calls[0][0] as any
    expect(request.path).toBe('/api/roles/r1/sessions/s1/messages/m1')
    expect(request.body.parts[0].text).toBe('先思考乙一下')
    expect(refreshTargetSession).toHaveBeenCalled()
  })

  it('会话正在运行时拒绝清洗', async () => {
    const { shared, deps } = buildShared({ running: true })
    const ops = createReasoningCleaningOperations(shared)

    const ok = await ops.cleanMessageReasoning('m1', '甲')

    expect(ok).toBe(false)
    expect(deps.netRequest).not.toHaveBeenCalled()
  })

  it('空关键词不触发清洗', async () => {
    const { shared, deps } = buildShared()
    const ops = createReasoningCleaningOperations(shared)

    const ok = await ops.cleanMessageReasoning('m1', '   \n  ')

    expect(ok).toBe(false)
    expect(deps.netRequest).not.toHaveBeenCalled()
    expect(deps.showToast).toHaveBeenCalledWith('请至少输入一个关键词', { kind: 'error' })
  })
})
