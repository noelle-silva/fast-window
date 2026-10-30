// 会话切换 / 加载的基准 fixture（design-1 §八 / design-4 P0）。
//
// 六个刻意构造的场景，每个都对应一类真实故障：
//
//   many-roles     角色数 ×4：验证切换耗时与角色数无关（验收指标 ≤1.1×）
//   long-session   长会话：验证窗口分页不会退化为全量加载
//   orphan-index   索引指向不存在的会话：验证不会产生幽灵会话
//   stale-active   activeChatId 指向已删除会话：验证回落而不报错
//   same-timestamp 多条消息同一 createdAt：验证排序稳定（(createdAt,id)）
//   deleted-offline 离线期间被删除的会话：验证不会复活
//
// 这里只产出纯数据，不含任何断言：benchmark 与集成测试共用同一套 fixture。

export type SwitchFixture = {
  name: string
  roleCount: number
  chatsPerRole: number
  messagesPerChat: number
  // 每个角色索引里的 chatIds（可能含不存在的会话）。
  orphanChatIds?: string[]
  // 每个角色的 activeChatId（可能指向已删除会话）。
  staleActiveChatId?: string
  // 是否让所有消息共享同一 createdAt。
  sameTimestamp?: boolean
}

function pad(value: number, width = 4) {
  return String(value).padStart(width, '0')
}

export function messageId(roleIndex: number, chatIndex: number, messageIndex: number) {
  return `r${pad(roleIndex)}-c${pad(chatIndex)}-m${pad(messageIndex)}`
}

export function chatId(roleIndex: number, chatIndex: number) {
  return `r${pad(roleIndex)}-c${pad(chatIndex)}`
}

export function roleId(roleIndex: number) {
  return `role-${pad(roleIndex)}`
}

// buildSessionMessages 产出「一条根消息 + 线性链」的会话消息。
// 首条无父（契约允许根消息无父），后续 parentMessageId 指向前一条。
export function buildSessionMessages(fixture: SwitchFixture, roleIndex: number, chatIndex: number) {
  const messages: any[] = []
  for (let index = 0; index < fixture.messagesPerChat; index++) {
    const createdAt = fixture.sameTimestamp ? 1000 : 1000 + index
    messages.push({
      id: messageId(roleIndex, chatIndex, index),
      branchId: 'main',
      parentMessageId: index === 0 ? '' : messageId(roleIndex, chatIndex, index - 1),
      createdAt,
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `消息 ${index}：${'x'.repeat(40)}`,
    })
  }
  return messages
}

// buildChatIndex 产出「角色索引」形状（chatIds / chatMetas / chatUpdatedAt）。
export function buildChatIndex(fixture: SwitchFixture, roleIndex: number) {
  const chatIds: string[] = []
  const chatMetas: any[] = []
  const chatUpdatedAt: Record<string, number> = {}
  for (let chatIndex = 0; chatIndex < fixture.chatsPerRole; chatIndex++) {
    const id = chatId(roleIndex, chatIndex)
    chatIds.push(id)
    chatUpdatedAt[id] = 1000 + chatIndex
    chatMetas.push({
      id,
      title: `会话 ${chatIndex}`,
      createdAt: 1000 + chatIndex,
      updatedAt: 1000 + chatIndex,
      lastMessagePreview: `预览 ${chatIndex}`,
      messageCount: fixture.messagesPerChat,
    })
  }
  if (fixture.orphanChatIds?.length) {
    for (const id of fixture.orphanChatIds) {
      chatIds.push(id)
      chatUpdatedAt[id] = 9999
      chatMetas.push({ id, title: '幽灵会话', createdAt: 9999, updatedAt: 9999, lastMessagePreview: '', messageCount: 0 })
    }
  }
  return { chatIds, chatMetas, chatUpdatedAt }
}

export const SWITCH_FIXTURES: SwitchFixture[] = [
  {
    name: 'many-roles',
    roleCount: 32,
    chatsPerRole: 6,
    messagesPerChat: 12,
  },
  {
    name: 'long-session',
    roleCount: 4,
    chatsPerRole: 3,
    messagesPerChat: 600,
  },
  {
    name: 'orphan-index',
    roleCount: 4,
    chatsPerRole: 3,
    messagesPerChat: 10,
    orphanChatIds: ['ghost-1', 'ghost-2'],
  },
  {
    name: 'stale-active',
    roleCount: 4,
    chatsPerRole: 3,
    messagesPerChat: 10,
    staleActiveChatId: 'deleted-chat',
  },
  {
    name: 'same-timestamp',
    roleCount: 4,
    chatsPerRole: 3,
    messagesPerChat: 40,
    sameTimestamp: true,
  },
  {
    name: 'deleted-offline',
    roleCount: 4,
    chatsPerRole: 3,
    messagesPerChat: 10,
  },
]

export function fixtureByName(name: string): SwitchFixture {
  const found = SWITCH_FIXTURES.find((fixture) => fixture.name === name)
  if (!found) throw new Error(`未知 fixture：${name}`)
  return found
}
