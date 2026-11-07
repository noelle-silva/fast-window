import { describe, expect, it, vi } from 'vitest'
import { createLazyChatStore } from './lazyChatStore'
import { createSessionWriteGuard } from './sessionWriteGuard'
import { createTargetChatSync } from './targetChatSync'
import type { ChatIndexSnapshot } from './splitProjectionCache'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function chatBody() {
  return {
    id: 'chat-race',
    title: '竞态会话',
    status: 'completed',
    createdAt: 100,
    updatedAt: 200,
    messages: [
      { id: 'message-1', type: 'user', role: 'user', content: '问', branchId: 'main', createdAt: 100, updatedAt: 100 },
    ],
  }
}

function stateWithChat() {
  const chat = chatBody()
  return {
    data: {
      chatsByRole: {
        'role-race': {
          activeChatId: chat.id,
          chatMetas: [{ id: chat.id, title: chat.title, createdAt: 100, updatedAt: 200 }],
          chats: [chat],
        },
      },
      chatsByGroup: {},
    },
  }
}

describe('并发竞态：删除后旧请求不得回填', () => {
  it('会话加载途中被删除：迟到正文不得写回内存', async () => {
    const guard = createSessionWriteGuard()
    const state = {
      data: {
        chatsByRole: { 'role-race': { activeChatId: '', chatMetas: [], chats: [] } },
        chatsByGroup: {},
      },
    }
    const requestStarted = deferred<void>()
    const response = deferred<any>()
    const store = createLazyChatStore({
      storage: {
        get: () => {
          requestStarted.resolve()
          return response.promise
        },
        set: async () => {},
        remove: async () => {},
      },
      getState: () => state,
      loadSplitMeta: async () => ({ roleFolders: { 'role-race': 'folder-race' } }),
      loadChatIndex: async () => null,
      sessionWrites: guard,
    })

    const pending = store.ensureChatLoaded('role', 'role-race', 'chat-race')
    await requestStarted.promise

    // 删除动作：控制器会推进会话代数，并立即把会话从内存移除。
    guard.invalidateSession('role', 'role-race', 'chat-race')
    store.removeLoadedChat('role', 'role-race', 'chat-race')

    // 删除之后，旧请求才慢吞吞返回。
    response.resolve(chatBody())
    const loaded = await pending

    expect(loaded).toBeNull()
    expect(state.data.chatsByRole['role-race'].chats).toEqual([])
    expect(state.data.chatsByRole['role-race'].chatMetas).toEqual([])
  })

  it('索引对账重取正文途中被删除：迟到正文不得 upsert，选中不得复活', async () => {
    const guard = createSessionWriteGuard()
    const state = stateWithChat()
    const requestStarted = deferred<void>()
    const response = deferred<any>()
    const upsert = vi.fn(() => ({ id: 'chat-race' }))
    const sync = createTargetChatSync({
      getState: () => state,
      reloadChatBody: async () => {
        requestStarted.resolve()
        return response.promise
      },
      upsertLoadedChat: upsert,
      hasActiveRun: () => false,
      getEpoch: () => 7,
      sessionWrites: guard,
    })
    const snapshot: ChatIndexSnapshot = {
      scope: 'role:role-race',
      activeChatId: 'chat-race',
      chatIds: ['chat-race'],
      chatUpdatedAt: { 'chat-race': 300 },
      chatVersions: { 'chat-race': 3 },
      chatMetas: [
        {
          id: 'chat-race',
          title: '竞态会话',
          createdAt: 100,
          updatedAt: 300,
          lastMessagePreview: '新',
          messageCount: 1,
          hasPending: false,
          runStatus: 'completed',
          runStatusChangedAt: 300,
          listAnchorAt: 300,
        },
      ],
      updatedAt: 300,
      revision: 9,
    }

    const pending = sync.syncTargetChats({ kind: 'role', targetId: 'role-race' }, snapshot, {
      force: true,
      isCurrent: () => true,
    })
    await requestStarted.promise

    guard.invalidateSession('role', 'role-race', 'chat-race')
    const box = state.data.chatsByRole['role-race']
    box.chats = []
    box.chatMetas = []
    box.activeChatId = ''

    response.resolve(chatBody())
    const applied = await pending

    expect(applied).toBe(false)
    expect(upsert).not.toHaveBeenCalled()
    expect(box.chats).toEqual([])
    expect(box.chatMetas).toEqual([])
    expect(box.activeChatId).toBe('')
  })
})
