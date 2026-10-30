import { describe, expect, it, vi } from 'vitest'
import { createChatOperationsShared } from './chatOperationsShared'
import { createProjectionPipeline } from './projectionPipeline'
import type { SessionScope, SessionSwitchClient } from '../protocol/sessionSwitchProtocol'
import type { ProjectionScope } from '../storage/splitProjectionCache'

// B1 真实链路回归：写后刷新**必须**保留已翻出的更早窗口。
//
// 这里刻意走 refreshTargetSession（写路径的真实入口），而不是直接调 reloadChatBody：
// 之前的测试绕过了「先失效再重读」这一步，因此没测出
// 「invalidateChatBody 顺带清掉分页状态 → refresh 只能拼回首窗 → 历史整体消失」。

const scope: ProjectionScope = { kind: 'role', targetId: 'role-1' }
const sessionScope: SessionScope = { kind: 'role', targetId: 'role-1' }

function message(id: string, createdAt: number, content = id) {
  return { id, branchId: 'main', parentMessageId: '', createdAt, content }
}

type WindowBackend = {
  // 首窗（最新一页）
  head: any[]
  // 更早的一页
  older: any[]
  // 每次请求记一笔，用来断言「真的重取了首窗」
  calls: Array<{ cursor?: string; head?: string }>
}

function makeWindowClient(backend: WindowBackend): SessionSwitchClient {
  return {
    healthCheckFeatures: ['session.window'],
    hasFeature: (feature: string) => feature === 'session.window',
    sessionIndexGet: async () => {
      throw new Error('未使用')
    },
    sessionSummaryList: async () => {
      throw new Error('未使用')
    },
    sessionGet: async () => {
      throw new Error('未使用')
    },
    setActiveChat: async () => ({ applied: true, preferenceRevision: 1, activeChatId: '' }),
    sessionWindow: async (_scope: any, chatId: string, options: any) => {
      backend.calls.push({ cursor: options?.cursor, head: options?.head })
      if (options?.cursor) {
        return { id: chatId, messages: backend.older, nextCursor: '' }
      }
      return { id: chatId, messages: backend.head, nextCursor: 'cursor-1' }
    },
  } as any
}

function makePipeline(backend: WindowBackend) {
  const meta = {
    roleOrder: ['role-1'],
    roleFolders: { 'role-1': '角色一' },
    groupOrder: [],
    groupFolders: {},
    providerOrder: [],
    providerFolders: {},
    modelGroupOrder: [],
    modelGroupFolders: {},
    ui: {},
    settings: {},
    updatedAt: 1,
  }
  return createProjectionPipeline({
    storage: { get: async () => null, set: async () => {} },
    sessionSwitch: makeWindowClient(backend),
    loadSplitMeta: async () => meta,
    getSplitMetaCache: () => meta,
    applyLocalSelection: () => {},
  })
}

function makeState() {
  return {
    loading: false,
    data: {
      roles: [{ id: 'role-1', name: '角色 A' }],
      groups: [],
      workspaces: [],
      chatsByRole: { 'role-1': { activeChatId: 'chat-1', chats: [] } },
      chatsByGroup: {},
      chatsByWorkspace: {},
      ui: { activeTargetKind: 'role', activeRoleId: 'role-1', activeGroupId: '', activeWorkspaceId: '' },
    },
    draft: { activeTargetKind: 'role', activeRoleId: 'role-1', activeGroupId: '', activeWorkspaceId: '' },
  }
}

function makeBackend(): WindowBackend {
  return {
    head: [
      message('m3', 300, '第三版'),
      message('m4', 400),
    ],
    older: [
      message('m1', 100),
      message('m2', 200),
    ],
    calls: [],
  }
}

describe('写后刷新保留已翻出的历史（真实链路）', () => {
  it('refreshTargetSession 之后更早窗口仍在（历史不缩回首屏）', async () => {
    const backend = makeBackend()
    const pipeline = makePipeline(backend)
    const state = makeState()

    // 1) 首屏一窗
    await pipeline.chatBodies.load(scope, 'chat-1')
    // 2) 往前翻一页
    await pipeline.loadOlderMessages(scope, 'chat-1')
    expect(pipeline.chatBodies.peek(scope, 'chat-1').messages.map((m: any) => m.id)).toEqual([
      'm1', 'm2', 'm3', 'm4',
    ])

    // 3) 模拟一次写（编辑 m3），然后走真实刷新入口
    backend.head = [message('m3', 300, '编辑后的文本'), message('m4', 400)]
    const shared = createChatOperationsShared({
      getState: () => state,
      save: async () => {},
      emit: () => {},
      render: () => {},
      renderComposer: () => {},
      scrollToBottomSoon: () => {},
      readImageFileAsDataUrl: async () => '',
      reloadRoleSession: async () => pipeline.reloadChatBody(scope, 'chat-1'),
      invalidateChatBody: (target, chatId) => pipeline.invalidateChatBody(target, chatId),
    })

    await shared.refreshTargetSession('role', 'role-1', 'chat-1')

    const refreshed = pipeline.chatBodies.peek(scope, 'chat-1')
    // 关键：更早的 m1 / m2 必须还在。
    expect(refreshed.messages.map((m: any) => m.id)).toEqual(['m1', 'm2', 'm3', 'm4'])
    // 编辑内容已生效。
    expect(refreshed.messages.find((m: any) => m.id === 'm3').content).toBe('编辑后的文本')
  })

  it('refreshTargetSession 之后从首窗删掉的消息不复活，且历史仍在', async () => {
    const backend = makeBackend()
    const pipeline = makePipeline(backend)
    const state = makeState()

    await pipeline.chatBodies.load(scope, 'chat-1')
    await pipeline.loadOlderMessages(scope, 'chat-1')

    // 写路径删掉首窗里的 m4
    backend.head = [message('m3', 300)]
    const shared = createChatOperationsShared({
      getState: () => state,
      save: async () => {},
      emit: () => {},
      render: () => {},
      renderComposer: () => {},
      scrollToBottomSoon: () => {},
      readImageFileAsDataUrl: async () => '',
      reloadRoleSession: async () => pipeline.reloadChatBody(scope, 'chat-1'),
      invalidateChatBody: (target, chatId) => pipeline.invalidateChatBody(target, chatId),
    })

    await shared.refreshTargetSession('role', 'role-1', 'chat-1')

    const refreshed = pipeline.chatBodies.peek(scope, 'chat-1')
    expect(refreshed.messages.map((m: any) => m.id)).toEqual(['m1', 'm2', 'm3'])
  })

  it('写后刷新确实重取了首窗（不是只读缓存）', async () => {
    const backend = makeBackend()
    const pipeline = makePipeline(backend)
    const state = makeState()

    await pipeline.chatBodies.load(scope, 'chat-1')
    await pipeline.loadOlderMessages(scope, 'chat-1')
    const before = backend.calls.length

    const shared = createChatOperationsShared({
      getState: () => state,
      save: async () => {},
      emit: () => {},
      render: () => {},
      renderComposer: () => {},
      scrollToBottomSoon: () => {},
      readImageFileAsDataUrl: async () => '',
      reloadRoleSession: async () => pipeline.reloadChatBody(scope, 'chat-1'),
      invalidateChatBody: (target, chatId) => pipeline.invalidateChatBody(target, chatId),
    })

    await shared.refreshTargetSession('role', 'role-1', 'chat-1')

    // 至少发生了一次「无 cursor 的首窗请求」。
    const newCalls = backend.calls.slice(before)
    expect(newCalls.some((call) => !call.cursor)).toBe(true)
  })

  it('invalidateChatBody 不再清掉分页状态（写路径语义）', async () => {
    const backend = makeBackend()
    const pipeline = makePipeline(backend)

    await pipeline.chatBodies.load(scope, 'chat-1')
    await pipeline.loadOlderMessages(scope, 'chat-1')
    expect(pipeline.sessionWindows.peek(sessionScope, 'chat-1')).not.toBeNull()

    pipeline.invalidateChatBody(scope, 'chat-1')

    // 正文缓存失效，但分页状态保留 —— 这是 refresh 能拼回历史的前提。
    expect(pipeline.chatBodies.peek(scope, 'chat-1')).toBeNull()
    expect(pipeline.sessionWindows.peek(sessionScope, 'chat-1')).not.toBeNull()
  })

  it('需要整份作废分页时走 invalidateSessionWindow（显式语义）', async () => {
    const backend = makeBackend()
    const pipeline = makePipeline(backend)

    await pipeline.chatBodies.load(scope, 'chat-1')
    await pipeline.loadOlderMessages(scope, 'chat-1')
    expect(pipeline.sessionWindows.peek(sessionScope, 'chat-1')).not.toBeNull()

    pipeline.invalidateSessionWindow(scope, 'chat-1')
    expect(pipeline.sessionWindows.peek(sessionScope, 'chat-1')).toBeNull()
  })

  it('epoch 换代仍然整份清空（分页也不留）', async () => {
    const backend = makeBackend()
    const pipeline = makePipeline(backend)

    await pipeline.chatBodies.load(scope, 'chat-1')
    await pipeline.loadOlderMessages(scope, 'chat-1')

    pipeline.applyVersions({ epoch: 42 })
    expect(pipeline.chatBodies.peek(scope, 'chat-1')).toBeNull()
    expect(pipeline.sessionWindows.peek(sessionScope, 'chat-1')).toBeNull()
  })
})
