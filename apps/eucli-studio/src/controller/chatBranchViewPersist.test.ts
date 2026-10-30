import { describe, expect, it, vi } from 'vitest'
import { createChatOperationsShared } from './chatOperationsShared'
import { createChatBranchOperations } from './chatBranchOperations'

// 决策 3：分支切换必须回写服务端（PATCH {base}/view）。
//
// 过去 setActiveBranch / switchBranchByAssistantSibling 只改本地 chat.branching，
// 从不回写；多客户端 / 重启后「用户在看哪条路径」丢失。

function makeChat() {
  // 结构：m1(assistant) → u1(user) → m2/m3(assistant 兄弟)
  // switchBranchByAssistantSibling 依赖「同一 prevAiMid 下的兄弟」，因此必须有这条链。
  return {
    id: 'chat-1',
    title: '会话',
    updatedAt: 1,
    branching: {
      schemaVersion: 1,
      activeBranchId: 'main',
      branches: [
        { id: 'main', name: '主线', headMid: 'm2', createdAt: 1, updatedAt: 1 },
        { id: 'alt', name: '分支 1', headMid: 'm3', createdAt: 2, updatedAt: 2 },
      ],
    },
    messages: [
      { id: 'm1', role: 'assistant', content: '开场', parentMid: '', branchId: 'main', createdAt: 1, updatedAt: 1 },
      { id: 'u1', role: 'user', content: 'q', parentMid: 'm1', branchId: 'main', createdAt: 2, updatedAt: 2 },
      { id: 'm2', role: 'assistant', content: 'a', parentMid: 'u1', branchId: 'main', createdAt: 3, updatedAt: 3 },
      { id: 'm3', role: 'assistant', content: 'b', parentMid: 'u1', branchId: 'alt', createdAt: 4, updatedAt: 4 },
    ],
  }
}

function makeHarness(options: { persist?: boolean } = {}) {
  const chat = makeChat()
  const state: any = {
    loading: false,
    data: {
      roles: [{ id: 'role-1', name: '角色 A' }],
      groups: [],
      workspaces: [],
      chatsByRole: { 'role-1': { activeChatId: 'chat-1', chats: [chat] } },
      chatsByGroup: {},
      chatsByWorkspace: {},
      ui: { activeTargetKind: 'role', activeRoleId: 'role-1', activeGroupId: '', activeWorkspaceId: '' },
    },
    draft: { activeTargetKind: 'role', activeRoleId: 'role-1', activeGroupId: '', activeWorkspaceId: '' },
    branchDraft: null,
  }

  const persistSessionView = vi.fn(async () => {})
  const shared = createChatOperationsShared({
    getState: () => state,
    save: async () => {},
    emit: () => {},
    render: () => {},
    renderComposer: () => {},
    scrollToBottomSoon: () => {},
    readImageFileAsDataUrl: async () => '',
    ensureActiveChatLoaded: async () => chat,
    ...(options.persist === false ? {} : { persistSessionView }),
  })
  return { state, chat, shared, persistSessionView }
}

describe('分支切换回写服务端视图（决策 3）', () => {
  it('setActiveBranch 回写 head 与 branchId', async () => {
    const harness = makeHarness()
    const ops = createChatBranchOperations(harness.shared)

    await ops.setActiveBranch('alt')

    expect(harness.persistSessionView).toHaveBeenCalledWith('role', 'role-1', 'chat-1', 'm3', 'alt')
  })

  it('switchBranchByAssistantSibling 回写切换后的 head', async () => {
    const harness = makeHarness()
    const ops = createChatBranchOperations(harness.shared)

    // 从 m2 切到同父的兄弟 m3（alt 分支）。
    await ops.switchBranchByAssistantSibling('m2', 1)

    expect(harness.persistSessionView).toHaveBeenCalled()
    const call = harness.persistSessionView.mock.calls[0] as any[]
    expect(call[0]).toBe('role')
    expect(call[1]).toBe('role-1')
    expect(call[2]).toBe('chat-1')
    // head 必须是切换后活动分支的头部消息。
    expect(String(call[3])).not.toBe('')
    expect(call[4]).toBe(String(harness.chat.branching.activeBranchId))
  })

  it('后端不支持视图回写时不影响本地切换（persist 缺席也不报错）', async () => {
    const harness = makeHarness({ persist: false })
    const ops = createChatBranchOperations(harness.shared)

    await expect(ops.setActiveBranch('alt')).resolves.toBeUndefined()
    expect(harness.chat.branching.activeBranchId).toBe('alt')
  })

  it('回写失败不打断本地切换', async () => {
    const harness = makeHarness()
    harness.persistSessionView.mockImplementation(async () => {
      throw new Error('后端失败')
    })
    const ops = createChatBranchOperations(harness.shared)

    await expect(ops.setActiveBranch('alt')).resolves.toBeUndefined()
    expect(harness.chat.branching.activeBranchId).toBe('alt')
  })

  it('head 为空时不发回写（无意义的请求）', async () => {
    const harness = makeHarness()
    // 清掉所有 headMid，让 activeBranchHeadMidOrLast 无从取得。
    harness.chat.branching.branches.forEach((branch: any) => {
      branch.headMid = ''
    })
    harness.chat.messages.length = 0
    const ops = createChatBranchOperations(harness.shared)

    await ops.setActiveBranch('alt')
    expect(harness.persistSessionView).not.toHaveBeenCalled()
  })
})
