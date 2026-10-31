import { describe, expect, it } from 'vitest'
import {
  activeEbRunCardsForTarget,
  findEbRoleRunCard,
  isRunSettled,
  markRunSettled,
  removeEbRoleRunCard,
  upsertEbRoleRunCard,
} from './activeRunCards'
import { shouldShowActiveRunTailPending } from './chatMessageDisplay'
import { settleRunInState } from './runTerminal'
import { ASSISTANT_RUNNING_CONTENT, beginAssistantRun, isAssistantGenerating } from './assistantRunState'

// 回归：run 终态必须收敛到「停止按钮消失 / 消息不再生成 / 占位清除」。
//
// 现场故障：AI 回复完成后停止按钮不消失，回复内容消失，只留下「生成中（流式）」
// 与一直旋转的圈。根因是终态只摘了 run 卡，消息的生成标记由另一条可被背压丢弃的
// update 事件收敛，两者不一致。

function createState(): any {
  return {
    data: {
      roles: [{ id: 'role-1', name: '角色 A' }],
      chatsByRole: {
        'role-1': {
          activeChatId: 'chat-1',
          chats: [
            {
              id: 'chat-1',
              status: 'running',
              updatedAt: 10,
              branching: { schemaVersion: 1, activeBranchId: 'main', branches: [{ id: 'main', name: '主线', headMid: 'm2', createdAt: 1, updatedAt: 10, forkFromMid: '' }] },
              messages: [
                { id: 'u1', role: 'user', content: '你好', branchId: 'main', parentMid: '', createdAt: 1, updatedAt: 1 },
                { id: 'm2', role: 'assistant', content: ASSISTANT_RUNNING_CONTENT, branchId: 'main', parentMid: 'u1', createdAt: 2, updatedAt: 2 },
              ],
            },
          ],
        },
      },
      chatsByGroup: {},
      chatsByWorkspace: {},
    },
    activeRunCards: [],
  }
}

function registerRunningCard(state: any) {
  return upsertEbRoleRunCard(state, {
    runId: 'run-1',
    roleId: 'role-1',
    sessionId: 'chat-1',
    inputMessageId: 'u1',
    lastMessageId: 'm2',
    anchorMessageId: 'u1',
    status: 'running',
    stream: true,
  })
}

describe('运行终态收敛（停止按钮 / 消息 / 占位）', () => {
  it('终态后停止按钮消失：run 卡被摘除', () => {
    const state = createState()
    registerRunningCard(state)
    expect(activeEbRunCardsForTarget(state, 'role', 'role-1', 'chat-1')).toHaveLength(1)

    settleRunInState(state, {
      runId: 'run-1',
      status: 'completed',
      roleId: 'role-1',
      sessionId: 'chat-1',
      messageIds: ['m2'],
    })

    // 输入区的停止按钮只看这个集合。
    expect(activeEbRunCardsForTarget(state, 'role', 'role-1', 'chat-1')).toHaveLength(0)
    expect(findEbRoleRunCard(state, 'run-1')).toBeNull()
  })

  it('终态后消息不再生成：同 run 的消息被收敛', () => {
    const state = createState()
    registerRunningCard(state)
    const message = state.data.chatsByRole['role-1'].chats[0].messages[1]
    beginAssistantRun(message, { generationId: 'run-1', stream: true, resetContent: false })
    expect(isAssistantGenerating(message)).toBe(true)

    settleRunInState(state, {
      runId: 'run-1',
      status: 'completed',
      roleId: 'role-1',
      sessionId: 'chat-1',
      messageIds: ['m2'],
    })

    expect(isAssistantGenerating(message)).toBe(false)
    expect(message.pending).toBe(false)
    expect(message.streaming).toBe(false)
  })

  it('终态后占位清除：尾部占位不再出现', () => {
    const state = createState()
    const card = registerRunningCard(state)
    const message = state.data.chatsByRole['role-1'].chats[0].messages[1]
    beginAssistantRun(message, { generationId: 'run-1', stream: true, resetContent: false })

    // 运行中：消息自身仍在生成，尾部不重复占位。
    expect(shouldShowActiveRunTailPending(card, [message], () => card)).toBe(false)

    settleRunInState(state, {
      runId: 'run-1',
      status: 'completed',
      roleId: 'role-1',
      sessionId: 'chat-1',
      messageIds: ['m2'],
    })

    const latestCard = activeEbRunCardsForTarget(state, 'role', 'role-1', 'chat-1').slice(-1)[0] || null
    expect(shouldShowActiveRunTailPending(latestCard, [message], () => latestCard)).toBe(false)
  })

  it('终态后迟到事件不能复活 run 卡（停止按钮不会重新出现）', () => {
    const state = createState()
    registerRunningCard(state)
    settleRunInState(state, { runId: 'run-1', status: 'completed', roleId: 'role-1', sessionId: 'chat-1', messageIds: ['m2'] })
    expect(isRunSettled(state, 'run-1')).toBe(true)

    // 乱序到达的「运行中」补丁（事件背压后重放 / 探针旧快照）。
    const revived = upsertEbRoleRunCard(state, {
      runId: 'run-1',
      roleId: 'role-1',
      sessionId: 'chat-1',
      lastMessageId: 'm2',
      status: 'running',
    })

    expect(revived).toBeNull()
    expect(activeEbRunCardsForTarget(state, 'role', 'role-1', 'chat-1')).toHaveLength(0)
  })

  it('终态后迟到事件不能把消息重新点亮成生成中', () => {
    const state = createState()
    registerRunningCard(state)
    const message = state.data.chatsByRole['role-1'].chats[0].messages[1]
    beginAssistantRun(message, { generationId: 'run-1', stream: true, resetContent: false })
    settleRunInState(state, { runId: 'run-1', status: 'completed', roleId: 'role-1', sessionId: 'chat-1', messageIds: ['m2'] })

    // 迟到的运行中补丁走同一条闩锁。
    upsertEbRoleRunCard(state, { runId: 'run-1', roleId: 'role-1', sessionId: 'chat-1', lastMessageId: 'm2', status: 'running' })
    expect(isAssistantGenerating(message)).toBe(false)
    expect(message.pending).toBe(false)
  })

  it('重复终态是幂等的：不产生二次副作用', () => {
    const state = createState()
    registerRunningCard(state)
    settleRunInState(state, { runId: 'run-1', status: 'failed', roleId: 'role-1', sessionId: 'chat-1', messageIds: ['m2'] })
    const firstLedger = { ...state.settledRuns }

    const changed = settleRunInState(state, { runId: 'run-1', status: 'completed', roleId: 'role-1', sessionId: 'chat-1', messageIds: ['m2'] })

    expect(changed).toBe(false)
    // 首次终态不可被后来的终态改写（同一条 run 只认第一个终态）。
    expect(state.settledRuns['run-1']).toBe(firstLedger['run-1'])
  })

  it('终态台账有界：过期条目惰性回收', () => {
    const state = createState()
    markRunSettled(state, 'run-old', 'completed', Date.now() - 11 * 60 * 1000)
    expect(isRunSettled(state, 'run-old')).toBe(false)
    expect(state.settledRuns['run-old']).toBeUndefined()
  })

  it('移除卡片登记终态闩锁（所有收尾路径一致）', () => {
    const state = createState()
    registerRunningCard(state)
    removeEbRoleRunCard(state, 'run-1')
    expect(isRunSettled(state, 'run-1')).toBe(true)
  })
})
