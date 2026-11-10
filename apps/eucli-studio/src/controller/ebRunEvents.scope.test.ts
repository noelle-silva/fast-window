// @vitest-environment happy-dom
//
// 流式增量与列表/运行卡通知：
//   - 正文/思考推进只走 message scope，不惊动会话列表；
//   - 只有「列表结构事实」变化（新消息落地 / 运行状态变化 / 终态 / 工具片段）
//     才写列表投影并补发 chatList scope；
//   - 运行卡只在卡片结构变化（对象身份变化）时补发 runCards scope。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createEbRunEventConsumer } from './ebRunEvents'
import { messageRefreshScope, refreshScopes } from '../domain/uiRefreshScope'

const ROLE_CHAT_LIST_SCOPE = refreshScopes.chatList('role', 'role-1')
const RUN_CARDS_SCOPE = refreshScopes.runCards()

function createHarness() {
  const state: any = {
    data: {
      roles: [{ id: 'role-1', name: '角色 A' }],
      groups: [],
      workspaces: [],
      chatsByRole: {},
      chatsByGroup: {},
      chatsByWorkspace: {},
    },
    activeRunCards: [],
    settledRuns: {},
  }
  let listener: ((event: any) => void) | null = null
  const emitScope = vi.fn()
  const consumer = createEbRunEventConsumer({
    getState: () => state,
    emitScope,
    subscribeDirectEvents: (next) => {
      listener = next
      return () => {
        listener = null
      }
    },
  })
  consumer.start()
  const send = (type: string, payload: any) => {
    listener?.({ name: 'eucliBox.run.event', payload: { type, runId: String(payload?.runId || 'run-1'), payload } })
  }
  return { state, emitScope, send }
}

type Harness = ReturnType<typeof createHarness>

const flushFrames = async () => {
  await new Promise((resolve) => setTimeout(resolve, 32))
}

function emittedScopes(harness: Harness) {
  return harness.emitScope.mock.calls.map((call) => call[0] as string)
}

function startRun(harness: Harness) {
  harness.send('run_started', {
    id: 'run-1',
    runId: 'run-1',
    roleId: 'role-1',
    sessionId: 'chat-1',
    inputMessageId: 'u1',
    lastMessageId: 'u1',
    status: 'running',
  })
}

function assistantDelta(extra: any = {}) {
  return {
    runId: 'run-1',
    roleId: 'role-1',
    sessionId: 'chat-1',
    messageId: 'm2',
    parentMessageId: 'u1',
    messageType: 'assistant',
    messageCreatedAt: 2,
    stream: true,
    ...extra,
  }
}

function assistantUpdate(extra: any = {}) {
  return {
    runId: 'run-1',
    roleId: 'role-1',
    sessionId: 'chat-1',
    stream: true,
    status: 'running',
    message: {
      id: 'm2',
      type: 'assistant',
      role: 'assistant',
      content: '第一段（更新）',
      parentMessageId: 'u1',
      createdAt: 2,
      updatedAt: 3,
    },
    ...extra,
  }
}

beforeEach(() => {
  vi.useRealTimers()
})

describe('运行事件的范围通知', () => {
  it('同结构的第二次流式增量不补发 chatList / runCards，只走 message', async () => {
    const harness = createHarness()
    startRun(harness)

    // 第一条增量把运行卡的目标消息从输入消息换成产出消息：卡片结构变了，必须广播一次。
    harness.emitScope.mockClear()
    harness.send('assistant_message_delta', assistantDelta({ contentDelta: '第一段' }))
    await flushFrames()
    expect(emittedScopes(harness)).toContain(RUN_CARDS_SCOPE)

    harness.emitScope.mockClear()
    harness.send('assistant_message_delta', assistantDelta({ contentDelta: '第二段' }))
    await flushFrames()

    const scopes = emittedScopes(harness)
    expect(scopes).toContain(messageRefreshScope('m2'))
    // 列表结构没变：条数、摘要、位置、运行指示都一样，不许惊动侧边栏。
    expect(scopes).not.toContain(ROLE_CHAT_LIST_SCOPE)
    // 运行卡结构没变：不许惊动 App 根。
    expect(scopes).not.toContain(RUN_CARDS_SCOPE)
  })

  it('新消息第一次落地的增量补发 chatList 与 runCards', async () => {
    const harness = createHarness()
    startRun(harness)

    harness.emitScope.mockClear()
    harness.send('assistant_message_delta', assistantDelta({ contentDelta: '第一段' }))
    await flushFrames()

    const scopes = emittedScopes(harness)
    expect(scopes).toContain(ROLE_CHAT_LIST_SCOPE)
    expect(scopes).toContain(RUN_CARDS_SCOPE)
  })

  it('同结构 assistant_message_update 不重复广播，运行状态变化时才广播', async () => {
    const harness = createHarness()
    startRun(harness)
    harness.send('assistant_message_delta', assistantDelta({ contentDelta: '第一段' }))
    await flushFrames()

    // 第一条 update 是列表结构事件（会话运行状态从空推进到 running），
    // 但运行卡的目标消息已由前面的增量建立，卡片结构没变：只补发 chatList。
    harness.emitScope.mockClear()
    harness.send('assistant_message_update', assistantUpdate())
    await flushFrames()
    const firstUpdate = emittedScopes(harness)
    expect(firstUpdate).toContain(ROLE_CHAT_LIST_SCOPE)
    expect(firstUpdate).not.toContain(RUN_CARDS_SCOPE)

    // 同结构重复到达：列表事实与卡片结构都没变，只刷新这一条消息。
    harness.emitScope.mockClear()
    harness.send('assistant_message_update', assistantUpdate())
    await flushFrames()
    const repeated = emittedScopes(harness)
    expect(repeated).toContain(messageRefreshScope('m2'))
    expect(repeated).not.toContain(ROLE_CHAT_LIST_SCOPE)
    expect(repeated).not.toContain(RUN_CARDS_SCOPE)

    // running → tool：列表上的运行指示与卡片状态都变了，必须补发。
    harness.emitScope.mockClear()
    harness.send('assistant_message_update', assistantUpdate({ status: 'tool' }))
    await flushFrames()
    const changed = emittedScopes(harness)
    expect(changed).toContain(ROLE_CHAT_LIST_SCOPE)
    expect(changed).toContain(RUN_CARDS_SCOPE)
  })

  it('终态 assistant_message_update 补发 chatList 与 runCards', async () => {
    const harness = createHarness()
    startRun(harness)
    harness.send('assistant_message_delta', assistantDelta({ contentDelta: '第一段' }))
    await flushFrames()

    harness.emitScope.mockClear()
    harness.send('assistant_message_update', assistantUpdate({ status: 'completed' }))
    await flushFrames()

    const scopes = emittedScopes(harness)
    expect(scopes).toContain(ROLE_CHAT_LIST_SCOPE)
    expect(scopes).toContain(RUN_CARDS_SCOPE)
  })

  it('工作区目标的 chatList 地址与侧边栏构造器一致', async () => {
    const harness = createHarness()
    harness.send('run_started', {
      id: 'run-1',
      runId: 'run-1',
      roleId: 'role-1',
      workspaceId: 'ws-1',
      sessionId: 'chat-1',
      inputMessageId: 'u1',
      lastMessageId: 'u1',
      status: 'running',
    })

    harness.emitScope.mockClear()
    harness.send('assistant_message_delta', assistantDelta({ workspaceId: 'ws-1', contentDelta: '第一段' }))
    await flushFrames()

    expect(emittedScopes(harness)).toContain(refreshScopes.chatList('workspace', 'ws-1::role-1'))
  })
})
