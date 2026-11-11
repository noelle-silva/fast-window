// 跨来源回归夹具：用一份「后台事实源」同时驱动三条写入来源。
//
// 三个来源只在写入动作上不同：
//   - 本地输入发送：走广播事件；
//   - 外部工具代发：走广播事件；
//   - 外部直接删改：不产生事件，靠重连后的版本核对收敛。
//
// 不管来源是什么，前端都只走同一条事实路径：
//   事件 / 版本核对 → 权威窗口重取 → 入状态 → 视图。
// 因此「界面消息」必须与后台会话文档逐项一致。

import { writeActiveChatSelection } from '../domain/activeChatSelection'
import { AI_CHAT_DIRECT_EVENT } from '../protocol/aiChatProtocol'
import type { SessionScope } from '../protocol/sessionSwitchProtocol'
import type { ChatIndexSnapshot } from '../storage/splitProjectionCache'
import { createLazyChatStore } from '../storage/lazyChatStore'
import { createSessionWindowLoader } from '../storage/sessionWindowLoader'
import { createUiPolling } from '../ui/uiPolling'

export const CROSS_SOURCE_ROLE_ID = 'role-cross-source'
export const CROSS_SOURCE_CHAT_ID = 'chat-cross-source'

export type BackendMessage = {
  id: string
  type: 'user' | 'assistant'
  role: 'user' | 'assistant'
  content: string
  parentMessageId: string
  branchId: string
  createdAt: number
  updatedAt: number
}

export type SessionChangeType =
  | 'message_added'
  | 'message_deleted'
  | 'message_subtree_deleted'
  | 'message_edited'
  | 'session_persisted'

export type SessionChangeEvent = {
  targetKind: 'message' | 'session'
  location: {
    kind: 'role'
    roleId: string
    groupId: string
    workspaceId: string
    sessionId: string
  }
  changeType: SessionChangeType
  version: number
  occurredAt: string
}

export type BackendSessionFact = {
  id: string
  roleId: string
  title: string
  status: string
  createdAt: number
  updatedAt: number
  version: number
  messages: BackendMessage[]
}

type MessageInput = {
  role: 'user' | 'assistant'
  content: string
  // 省略时按业务端归一化规则接到当前最后一条消息之后。
  parentMessageId?: string
}

type SeedMessageInput = {
  id: string
  role: 'user' | 'assistant'
  content: string
  parentMessageId?: string
}

function copyMessages(messages: readonly BackendMessage[]): BackendMessage[] {
  return messages.map((message) => ({ ...message }))
}

// createSessionFactsBackend 是 eucli-box 会话写入契约的最小实现：
// 五类变更各自递增版本，删除单条消息会把子节点挂回被删消息的父节点，
// 删除子树会连带删除全部后代。
export function createSessionFactsBackend() {
  let sequence = 0
  let clock = 1_000
  const session: BackendSessionFact = {
    id: CROSS_SOURCE_CHAT_ID,
    roleId: CROSS_SOURCE_ROLE_ID,
    title: '跨来源回归会话',
    status: 'idle',
    createdAt: clock,
    updatedAt: clock,
    version: 0,
    messages: [],
  }

  function nextClock() {
    clock += 10
    return clock
  }

  function nextMessageId() {
    sequence += 1
    return `message-${sequence}`
  }

  function changeEvent(changeType: SessionChangeType): SessionChangeEvent {
    session.version += 1
    session.updatedAt = nextClock()
    return {
      targetKind: changeType === 'session_persisted' ? 'session' : 'message',
      location: {
        kind: 'role',
        roleId: session.roleId,
        groupId: '',
        workspaceId: '',
        sessionId: session.id,
      },
      changeType,
      version: session.version,
      occurredAt: new Date(session.updatedAt).toISOString(),
    }
  }

  function lastMessageId(): string {
    return session.messages.length ? session.messages[session.messages.length - 1].id : ''
  }

  // seed 建立测试的起点会话，不产生变更事件：版本从 1 开始。
  function seed(messages: SeedMessageInput[]) {
    session.messages = []
    sequence = 0
    for (const input of messages) {
      const id = input.id
      sequence = Math.max(sequence, Number(id.split('-').pop()) || sequence)
      const createdAt = nextClock()
      session.messages.push({
        id,
        type: input.role,
        role: input.role,
        content: input.content,
        parentMessageId: input.parentMessageId ?? (session.messages.length ? lastMessageId() : ''),
        branchId: 'main',
        createdAt,
        updatedAt: createdAt,
      })
    }
    session.status = 'idle'
    session.version = 1
    session.createdAt = session.messages[0]?.createdAt || clock
    session.updatedAt = clock
  }

  function appendMessages(inputs: MessageInput[]): { event: SessionChangeEvent; messages: BackendMessage[] } {
    const created: BackendMessage[] = []
    for (const input of inputs) {
      const createdAt = nextClock()
      const message: BackendMessage = {
        id: nextMessageId(),
        type: input.role,
        role: input.role,
        content: input.content,
        parentMessageId: input.parentMessageId ?? (session.messages.length ? lastMessageId() : ''),
        branchId: 'main',
        createdAt,
        updatedAt: createdAt,
      }
      session.messages.push(message)
      created.push(message)
    }
    return { event: changeEvent('message_added'), messages: created }
  }

  function editMessage(messageId: string, content: string): SessionChangeEvent {
    const message = session.messages.find((item) => item.id === messageId)
    if (!message) throw new Error(`message not found: ${messageId}`)
    message.content = content
    message.updatedAt = nextClock()
    return changeEvent('message_edited')
  }

  function deleteMessage(messageId: string): SessionChangeEvent {
    const target = session.messages.find((item) => item.id === messageId)
    if (!target) throw new Error(`message not found: ${messageId}`)
    const parentMessageId = target.parentMessageId
    session.messages = session.messages
      .filter((item) => item.id !== messageId)
      .map((item) =>
        item.parentMessageId === messageId
          ? { ...item, parentMessageId, updatedAt: nextClock() }
          : item,
      )
    return changeEvent('message_deleted')
  }

  function deleteSubtree(messageId: string): SessionChangeEvent {
    if (!session.messages.some((item) => item.id === messageId)) {
      throw new Error(`message not found: ${messageId}`)
    }
    const children = new Map<string, string[]>()
    for (const message of session.messages) {
      if (!message.parentMessageId) continue
      const list = children.get(message.parentMessageId) || []
      list.push(message.id)
      children.set(message.parentMessageId, list)
    }
    const deleted = new Set<string>()
    const stack = [messageId]
    while (stack.length) {
      const current = stack.pop()!
      if (deleted.has(current)) continue
      deleted.add(current)
      stack.push(...(children.get(current) || []))
    }
    session.messages = session.messages.filter((item) => !deleted.has(item.id))
    return changeEvent('message_subtree_deleted')
  }

  function persistSession(status = 'completed'): SessionChangeEvent {
    session.status = status
    return changeEvent('session_persisted')
  }

  function snapshot(): ChatIndexSnapshot {
    return {
      scope: `role:${session.roleId}`,
      activeChatId: session.id,
      chatIds: [session.id],
      chatUpdatedAt: { [session.id]: session.updatedAt },
      chatVersions: { [session.id]: session.version },
      chatMetas: [
        {
          id: session.id,
          title: session.title,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          lastMessagePreview: session.messages.at(-1)?.content || '',
          messageCount: session.messages.length,
          hasPending: false,
          runStatus: 'idle',
          runStatusChangedAt: 0,
          listAnchorAt: session.updatedAt,
          contextTokens: 0,
        },
      ],
      updatedAt: session.updatedAt,
      revision: session.version,
    }
  }

  // 窗口只做「事实投影」：head 命中时返回以它为终点的路径；未命中时返回空窗。
  // 空窗是业务端事实，前端不得再退默认路径（design-4-2）。
  async function sessionWindow(
    _scope: SessionScope,
    chatId: string,
    options?: { head?: string; cursor?: string },
  ) {
    if (chatId !== session.id) throw new Error(`unknown session: ${chatId}`)
    const head = String(options?.head || '').trim()
    let messages = copyMessages(session.messages)
    if (head) {
      const byId = new Map(session.messages.map((message) => [message.id, message]))
      if (!byId.has(head)) return { id: session.id, messages: [], nextCursor: '' }
      const path = new Set<string>()
      let current = head
      while (current && !path.has(current)) {
        path.add(current)
        current = byId.get(current)?.parentMessageId || ''
      }
      messages = messages.filter((message) => path.has(message.id))
    }
    return {
      id: session.id,
      title: session.title,
      status: session.status,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      version: session.version,
      messages,
      nextCursor: '',
    }
  }

  return {
    session,
    seed,
    appendMessages,
    editMessage,
    deleteMessage,
    deleteSubtree,
    persistSession,
    snapshot,
    hasFeature: () => true,
    sessionWindow,
  }
}

export type SessionFactsBackend = ReturnType<typeof createSessionFactsBackend>

function makeState(roleId: string) {
  return {
    loading: false,
    data: {
      ui: {
        activeTargetKind: 'role',
        activeRoleId: roleId,
        activeGroupId: '',
        activeWorkspaceId: '',
      },
      roles: [{ id: roleId, name: '跨来源角色' }],
      groups: [],
      workspaces: [],
      chatsByRole: { [roleId]: { activeChatId: '', chatMetas: [], chats: [] as any[] } },
      chatsByGroup: {},
      chatsByWorkspace: {},
    },
    draft: {
      activeTargetKind: 'role',
      activeRoleId: roleId,
      activeGroupId: '',
      activeWorkspaceId: '',
    },
  }
}

// createSessionFactsHarness 把后台事实源接到真实的前端事实路径上：
// uiPolling → sessionChangeReconciler → targetChatSync → sessionWindowLoader
// → lazyChatStore。测试断言的就是这条路径最终写进视图的会话正文。
export function createSessionFactsHarness() {
  const backend = createSessionFactsBackend()
  const state = makeState(CROSS_SOURCE_ROLE_ID)
  const scope = { kind: 'role' as const, targetId: CROSS_SOURCE_ROLE_ID }
  const loader = createSessionWindowLoader({
    sessionSwitch: backend,
    // 跨来源场景统一走权威路径，head 不是本组回归的变量。
    headFor: () => '',
  })
  const store = createLazyChatStore({
    storage: { get: async () => null, set: async () => {} },
    getState: () => state,
    loadSplitMeta: async () => ({ roleFolders: { [CROSS_SOURCE_ROLE_ID]: 'folder-cross-source' } }),
    loadChatIndex: async () => null,
  })

  let eventListener: ((event: any) => void) | null = null
  let reconnectListener: (() => void) | null = null

  const polling = createUiPolling({
    getState: () => state,
    emitScope: () => {},
    subscribeDirectEvents: (listener) => {
      eventListener = listener
      return () => { eventListener = null }
    },
    onReconnected: (listener) => {
      reconnectListener = listener
      return () => { reconnectListener = null }
    },
    activeTargetKind: () => 'role',
    activeChatFromData: () => {
      const box = state.data.chatsByRole[CROSS_SOURCE_ROLE_ID]
      const activeChatId = String(box?.activeChatId || '')
      return box?.chats.find((chat: any) => String(chat?.id || '') === activeChatId) || null
    },
    refreshChatIndex: async () => backend.snapshot(),
    reloadChatBody: (projectionScope, chatId, options) =>
      loader.refresh({ kind: projectionScope.kind, targetId: projectionScope.targetId }, chatId, options),
    upsertLoadedChat: (kind, targetId, chat) => store.upsertLoadedChat(kind, targetId, chat),
    syncWorkspaceChatById: async () => false,
    refreshWorkspaceChats: async () => null,
    getEpoch: () => 1,
  })

  function emit(event: SessionChangeEvent) {
    eventListener?.({ name: AI_CHAT_DIRECT_EVENT.eucliBoxSessionChange, payload: event })
  }

  function reconnect() {
    reconnectListener?.()
  }

  async function settle() {
    await new Promise((resolve) => setTimeout(resolve, 20))
  }

  async function loadInitialConversation() {
    const chat = await loader.load(scope, CROSS_SOURCE_CHAT_ID)
    const loaded = store.upsertLoadedChat('role', CROSS_SOURCE_ROLE_ID, chat)
    if (loaded) writeActiveChatSelection(state.data.chatsByRole[CROSS_SOURCE_ROLE_ID], CROSS_SOURCE_CHAT_ID)
    return loaded
  }

  function viewChat(): any {
    return state.data.chatsByRole[CROSS_SOURCE_ROLE_ID].chats.find(
      (chat: any) => String(chat?.id || '') === CROSS_SOURCE_CHAT_ID,
    ) || null
  }

  function viewMessages(): any[] {
    const messages = viewChat()?.messages
    return Array.isArray(messages) ? messages : []
  }

  return {
    backend,
    loadInitialConversation,
    start: () => polling.startUiPollers(),
    stop: () => polling.stopUiPollers(),
    emit,
    reconnect,
    settle,
    viewChat,
    viewMessages,
  }
}

export type SessionFactsHarness = ReturnType<typeof createSessionFactsHarness>

// 视图与后台事实的逐项对照：存在性、正文、顺序、父子拓扑。
export function viewFactRows(messages: readonly any[]) {
  return messages.map((message) => ({
    id: String(message?.id || '').trim(),
    content: String(message?.content ?? ''),
    parentMid: String(message?.parentMid ?? message?.parentMessageId ?? '').trim(),
  }))
}

export function backendFactRows(messages: readonly BackendMessage[]) {
  return messages.map((message) => ({
    id: message.id,
    content: message.content,
    parentMid: message.parentMessageId,
  }))
}
