import { activeRunCardForAssistantMessage } from '../../domain/chatMessageDisplay'

export type ChatListIndex = {
  runCardByMid: Map<string, any>
  branchSiblingsByMid: Map<string, any[]>
  branchIndexByMid: Map<string, number>
  nextAssistantMidByUserMid: Map<string, string>
}

function messageId(message: any) {
  return String(message?.id || '').trim()
}

// buildChatListIndex 一次性预建消息列表需要的全部索引：
//   - runCardByMid：活动运行卡（替代每行线性扫卡）
//   - branchSiblingsByMid / branchIndexByMid：分支兄弟与位置（替代每行 findIndex）
//   - nextAssistantMidByUserMid：用户消息的重新回复目标（替代每行 findIndex）
// 全部 O(n)，行内一律 O(1)。这是行级 memo 契约成立的前提。
export function buildChatListIndex(input: {
  messages: any[]
  chatAllMessagesRaw: any[]
  activeVisibleRunCards: any[]
  prevAiMidByAssistantId: Map<string, string>
  assistantSiblingsByPrevAiMid: Map<string, any[]>
}): ChatListIndex {
  const { messages, chatAllMessagesRaw, activeVisibleRunCards, prevAiMidByAssistantId, assistantSiblingsByPrevAiMid } = input

  const runCardByMid = new Map<string, any>()
  for (const message of messages) {
    const mid = messageId(message)
    if (!mid) continue
    const card = activeRunCardForAssistantMessage(activeVisibleRunCards, message)
    if (card) runCardByMid.set(mid, card)
  }

  const branchSiblingsByMid = new Map<string, any[]>()
  const branchIndexByMid = new Map<string, number>()
  for (const message of messages) {
    if (!message || message.role !== 'assistant') continue
    const mid = messageId(message)
    if (!mid) continue
    const prevAiMid = String(prevAiMidByAssistantId.get(mid) || '').trim()
    if (!prevAiMid) continue
    const siblings = assistantSiblingsByPrevAiMid.get(prevAiMid)
    if (!siblings || !siblings.length) continue
    branchSiblingsByMid.set(mid, siblings)
    let index = -1
    for (let i = 0; i < siblings.length; i++) {
      if (String(siblings[i]?.id || '') === mid) {
        index = i
        break
      }
    }
    if (index >= 0) branchIndexByMid.set(mid, index)
  }

  const nextAssistantMidByUserMid = new Map<string, string>()
  const raw = Array.isArray(chatAllMessagesRaw) ? chatAllMessagesRaw : []
  // 与既有语义严格一致：从用户消息往后看，遇到第一条有效消息；
  // 是 AI → 它是重新回复目标；是用户 → 没有目标（保持以本条为落点）。
  for (let i = 0; i < raw.length; i++) {
    const message = raw[i]
    if (!message || message.role !== 'user') continue
    const userMid = messageId(message)
    if (!userMid) continue
    for (let j = i + 1; j < raw.length; j++) {
      const next = raw[j]
      if (!next) continue
      if (next.role === 'assistant') nextAssistantMidByUserMid.set(userMid, messageId(next))
      break
    }
  }

  return { runCardByMid, branchSiblingsByMid, branchIndexByMid, nextAssistantMidByUserMid }
}
