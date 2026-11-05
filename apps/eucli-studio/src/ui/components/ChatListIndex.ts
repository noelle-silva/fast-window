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

  // 重新回复目标只由后台父子拓扑决定：用户消息的直接助手子节点中最早的一条。
  // 不再按数组顺序寻找「下一条消息」。
  const nextAssistantMidByUserMid = new Map<string, string>()
  const raw = Array.isArray(chatAllMessagesRaw) ? chatAllMessagesRaw : []
  const assistantChildrenByParent = new Map<string, any[]>()
  for (const message of raw) {
    if (!message || message.role !== 'assistant') continue
    const parentMid = String((message as any)?.parentMid || '').trim()
    if (!parentMid) continue
    const list = assistantChildrenByParent.get(parentMid) || []
    list.push(message)
    assistantChildrenByParent.set(parentMid, list)
  }
  for (const [userMid, children] of assistantChildrenByParent.entries()) {
    children.sort((left: any, right: any) => {
      const l = Number(left?.createdAt || 0)
      const r = Number(right?.createdAt || 0)
      if (l !== r) return l - r
      return messageId(left).localeCompare(messageId(right))
    })
    const first = children[0]
    if (first) nextAssistantMidByUserMid.set(userMid, messageId(first))
  }

  return { runCardByMid, branchSiblingsByMid, branchIndexByMid, nextAssistantMidByUserMid }
}
