import { describe, expect, it, vi } from 'vitest'
import { activeBranchHeadMid } from '../domain/branching'
import { isAssistantGenerating } from '../domain/assistantRunState'
import { createLazyChatStore } from './lazyChatStore'
import {
  BOUNDARY_ROLE_ID,
  SECOND_ASSISTANT_MESSAGE_ID,
  SECOND_USER_MESSAGE_ID,
  rawSessionDocument,
} from '../testing/boundaryFixtures'

// 边界二：归一化 → 入状态。
//
// upsertLoadedChat 是「会话进入内存状态」的唯一入口。契约：
//   - 原始字节与已归一化会话都得到同一种内存形状；
//   - 服务端快照是消息集合成员资格的权威来源，已删除消息不能被本地旧对象复活；
//   - 运行期独占、尚未落盘的最终回复不能被旧存储页覆盖（新消息不消失）；
//   - 已存分支头只前进，服务端更新的头不能被本地运行期旧头拉回。

function createHarness() {
  const state: any = {
    data: {
      chatsByRole: { [BOUNDARY_ROLE_ID]: { activeChatId: '', chatMetas: [], chats: [] } },
      chatsByGroup: {},
    },
  }
  const store = createLazyChatStore({
    storage: { get: vi.fn(async () => null), set: vi.fn(async () => {}) },
    getState: () => state,
    loadSplitMeta: vi.fn(async () => ({})),
    loadChatIndex: vi.fn(async () => null),
  })
  return { state, store }
}

function localChat(input: {
  id: string
  title: string
  updatedAt: number
  messages: any[]
  headMid: string
}) {
  return {
    id: input.id,
    title: input.title,
    status: 'running',
    createdAt: 1000,
    updatedAt: input.updatedAt,
    messages: input.messages,
    branching: {
      schemaVersion: 1,
      activeBranchId: 'main',
      branches: [
        {
          id: 'main',
          name: '主分支',
          headMid: input.headMid,
          createdAt: 1000,
          updatedAt: input.updatedAt,
          forkFromMid: '',
        },
      ],
    },
  }
}

describe('契约·边界二：归一化 → 入状态', () => {
  it('原始会话入状态后保留父子链与数值时间（消息树不断链、列表时间不塌缩）', () => {
    const { state, store } = createHarness()
    const chat = store.upsertLoadedChat('role', BOUNDARY_ROLE_ID, rawSessionDocument())

    expect(chat).not.toBeNull()
    const messages = chat?.messages || []
    expect(messages.find((message: any) => message.id === SECOND_USER_MESSAGE_ID)?.parentMid).toBe(
      'message-1793460445487972300-17745',
    )
    expect(messages.find((message: any) => message.id === SECOND_ASSISTANT_MESSAGE_ID)?.parentMid).toBe(
      SECOND_USER_MESSAGE_ID,
    )
    expect(typeof chat?.updatedAt).toBe('number')

    const meta = state.data.chatsByRole[BOUNDARY_ROLE_ID].chatMetas.find((item: any) => item.id === chat?.id)
    expect(meta?.updatedAt).toBe(Date.parse('2026-10-31T17:39:14.4078946Z'))
  })

  it('服务端快照已删除的消息不会被本地运行期旧对象复活', () => {
    const { store } = createHarness()
    const local = localChat({
      id: 'chat-delete-regression',
      title: '删除回归',
      updatedAt: 2000,
      headMid: 'message-deleted',
      messages: [
        { id: 'message-user', type: 'user', role: 'user', content: '问', branchId: 'main', createdAt: 1000, updatedAt: 1000 },
        {
          id: 'message-deleted',
          type: 'assistant',
          role: 'assistant',
          content: '这条回复已经被用户删除',
          parentMessageId: 'message-user',
          branchId: 'main',
          createdAt: 1500,
          updatedAt: 2000,
          // 历史故障形态：本地旧对象仍处于「生成中且有可见产出」，
          // 但没有运行期独占身份；旧代码会把它当成本地独有消息补回集合。
          pending: true,
          streaming: true,
          assistantRun: {
            generationId: 'run-deleted',
            status: 'running',
            mode: 'new',
            stream: true,
            startedAt: 1500,
            updatedAt: 2000,
          },
        },
      ],
    })
    store.upsertLoadedChat('role', BOUNDARY_ROLE_ID, local)

    const serverSnapshot = localChat({
      id: 'chat-delete-regression',
      title: '删除回归',
      updatedAt: 2500,
      headMid: 'message-user',
      messages: [
        { id: 'message-user', type: 'user', role: 'user', content: '问', branchId: 'main', createdAt: 1000, updatedAt: 1000 },
      ],
    })
    const chat = store.upsertLoadedChat('role', BOUNDARY_ROLE_ID, serverSnapshot)

    expect(chat?.messages.map((message: any) => message.id)).toEqual(['message-user'])
    expect(chat?.messages.some((message: any) => message.id === 'message-deleted')).toBe(false)
  })

  it('运行期独占的最终回复不会因旧存储页而消失', () => {
    const { store } = createHarness()
    const local = localChat({
      id: 'chat-runtime-final',
      title: '终态回复',
      updatedAt: 3000,
      headMid: 'message-final',
      messages: [
        { id: 'message-user', type: 'user', role: 'user', content: '问', branchId: 'main', createdAt: 1000, updatedAt: 1000 },
        {
          id: 'message-final',
          type: 'assistant',
          role: 'assistant',
          content: '完整回复',
          parentMessageId: 'message-user',
          branchId: 'main',
          createdAt: 2000,
          updatedAt: 3000,
          pending: false,
          streaming: false,
          assistantRun: {
            generationId: 'run-final',
            status: 'succeeded',
            mode: 'new',
            stream: true,
            startedAt: 2000,
            updatedAt: 3000,
            finishedAt: 3000,
          },
        },
      ],
    })
    const first = store.upsertLoadedChat('role', BOUNDARY_ROLE_ID, local)
    const runtimeMessage = first?.messages.find((message: any) => message.id === 'message-final')
    expect(runtimeMessage).toBeTruthy()
    // 事件消费者创建的运行期独占消息会带这个显式身份；存储确认后由服务端对象替换。
    runtimeMessage.runtimeOnly = true
    expect(isAssistantGenerating(runtimeMessage)).toBe(false)

    // 落盘前的旧页：只含用户消息，尚无最终回复。
    const stalePage = localChat({
      id: 'chat-runtime-final',
      title: '终态回复',
      updatedAt: 2500,
      headMid: 'message-user',
      messages: [
        { id: 'message-user', type: 'user', role: 'user', content: '问', branchId: 'main', createdAt: 1000, updatedAt: 1000 },
      ],
    })
    const chat = store.upsertLoadedChat('role', BOUNDARY_ROLE_ID, stalePage)

    expect(chat?.messages.map((message: any) => message.id)).toEqual(['message-user', 'message-final'])
    expect(chat?.messages.find((message: any) => message.id === 'message-final')?.content).toBe('完整回复')
    expect(activeBranchHeadMid(chat)).toBe('message-final')
  })

  it('分支头只前进：服务端更新的头不会被本地运行期旧头拉回', () => {
    const { store } = createHarness()
    const local = localChat({
      id: 'chat-branch-head',
      title: '分支头回归',
      updatedAt: 2000,
      headMid: 'message-a3',
      messages: [
        { id: 'message-u1', type: 'user', role: 'user', content: '问', branchId: 'main', createdAt: 1000, updatedAt: 1000 },
        {
          id: 'message-a1',
          type: 'assistant',
          role: 'assistant',
          content: '旧回答',
          parentMessageId: 'message-u1',
          branchId: 'main',
          createdAt: 1500,
          updatedAt: 1500,
        },
        {
          id: 'message-a3',
          type: 'assistant',
          role: 'assistant',
          content: '本地运行期旧头',
          parentMessageId: 'message-a1',
          branchId: 'main',
          createdAt: 1800,
          updatedAt: 2000,
        },
      ],
    })
    const first = store.upsertLoadedChat('role', BOUNDARY_ROLE_ID, local)
    const runtimeHead = first?.messages.find((message: any) => message.id === 'message-a3')
    expect(runtimeHead).toBeTruthy()
    runtimeHead.runtimeOnly = true

    // 服务端已经落盘并推进到 a4；a3 的 updatedAt 也比本地更晚。
    const newerServer = localChat({
      id: 'chat-branch-head',
      title: '分支头回归',
      updatedAt: 4000,
      headMid: 'message-a4',
      messages: [
        { id: 'message-u1', type: 'user', role: 'user', content: '问', branchId: 'main', createdAt: 1000, updatedAt: 1000 },
        {
          id: 'message-a1',
          type: 'assistant',
          role: 'assistant',
          content: '旧回答',
          parentMessageId: 'message-u1',
          branchId: 'main',
          createdAt: 1500,
          updatedAt: 1500,
        },
        {
          id: 'message-a3',
          type: 'assistant',
          role: 'assistant',
          content: '已落盘回答',
          parentMessageId: 'message-a1',
          branchId: 'main',
          createdAt: 1800,
          updatedAt: 3000,
        },
        {
          id: 'message-a4',
          type: 'assistant',
          role: 'assistant',
          content: '服务端更新的回答',
          parentMessageId: 'message-a3',
          branchId: 'main',
          createdAt: 4000,
          updatedAt: 4000,
        },
      ],
    })
    const chat = store.upsertLoadedChat('role', BOUNDARY_ROLE_ID, newerServer)

    expect(activeBranchHeadMid(chat)).toBe('message-a4')
  })
})
