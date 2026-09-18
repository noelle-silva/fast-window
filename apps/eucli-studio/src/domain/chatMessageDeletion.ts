import { ensureChatBranching, normalizeBranchId } from './branching'

const BRANCH_HEAD_REPAIR_GUARD_LIMIT = 6000

export type DeleteSingleMessagePlan = {
  nextMessages: any[]
  deletedMessageIds: Set<string>
  deletedMessageParentById: Record<string, string>
  targetParentMid: string
}

export type DeleteMessageSubtreePlan = {
  nextMessages: any[]
  deletedMessageIds: Set<string>
  deletedMessageParentById: Record<string, string>
  subtreeRootIds: string[]
}

function messageIdOf(message: any) {
  return String(message?.id || '').trim()
}

function parentMessageIdOf(message: any) {
  return String((message as any)?.parentMid || '').trim()
}

function collectMessagesById(messages: any[]) {
  const byId = new Map<string, any>()
  for (const message of messages) {
    const id = messageIdOf(message)
    if (!id || byId.has(id)) continue
    byId.set(id, message)
  }
  return byId
}

function findNearestExistingAncestor(headMid: string, oldById: Map<string, any>, currentById: Map<string, any>) {
  let current = String(headMid || '').trim()
  const seen = new Set<string>()
  let guard = 0

  while (current && !currentById.has(current) && !seen.has(current) && guard < BRANCH_HEAD_REPAIR_GUARD_LIMIT) {
    guard++
    seen.add(current)
    const message = oldById.get(current) || null
    current = message ? parentMessageIdOf(message) : ''
  }

  return current && currentById.has(current) ? current : ''
}

function pickLatestMessageInBranch(messages: any[], branchId: string) {
  let pickedId = ''
  let pickedAt = -1

  for (const message of messages) {
    if (!message || typeof message !== 'object') continue
    if (normalizeBranchId((message as any)?.branchId) !== branchId) continue
    const createdAt = Number((message as any)?.createdAt || 0)
    if (createdAt <= pickedAt) continue
    pickedAt = createdAt
    pickedId = messageIdOf(message)
  }

  return pickedId
}

function repairBranchHeads(
  chat: any,
  oldById: Map<string, any>,
  currentMessages: any[],
  fallbackForBranch: (currentById: Map<string, any>, lastMessageId: string) => string,
) {
  const branching = ensureChatBranching(chat)
  const currentById = collectMessagesById(currentMessages)
  const lastMessageId = currentMessages.length ? messageIdOf(currentMessages[currentMessages.length - 1]) : ''
  const branches = Array.isArray((branching as any)?.branches) ? ((branching as any).branches as any[]) : []

  for (const branch of branches) {
    const branchId = normalizeBranchId((branch as any)?.id)
    if (!branchId) continue

    const currentHeadMid = String((branch as any)?.headMid || '').trim()
    if (currentHeadMid && currentById.has(currentHeadMid)) continue

    const ancestorMid = findNearestExistingAncestor(currentHeadMid, oldById, currentById)
    if (ancestorMid) {
      ;(branch as any).headMid = ancestorMid
      continue
    }

    ;(branch as any).headMid = pickLatestMessageInBranch(currentMessages, branchId) || fallbackForBranch(currentById, lastMessageId)
  }
}

export function planDeleteSingleMessage(messages: any[], messageId: any, target: any): DeleteSingleMessagePlan {
  const mid = String(messageId || '').trim()
  const targetParentMid = parentMessageIdOf(target)
  const deletedMessageIds = new Set<string>([mid])
  const deletedMessageParentById: Record<string, string> = { [mid]: targetParentMid }
  const groupId = String((target as any)?.groupId || '').trim()
  const groupRole = String((target as any)?.groupRole || '').trim()
  const rootMid = messageIdOf(target)

  const remainingMessages =
    target?.role === 'user' && groupId && groupRole === 'root'
      ? messages.filter((message: any) => {
          if (!message || typeof message !== 'object') return true
          const id = messageIdOf(message)
          if (id === mid) return false
          if (String(message?.role || '') !== 'user') return true
          if (String((message as any)?.groupId || '').trim() !== groupId) return true
          if (String((message as any)?.groupRole || '').trim() !== 'attachment') return true
          if (String((message as any)?.groupParentMid || '').trim() !== rootMid) return true
          if (id) {
            deletedMessageIds.add(id)
            deletedMessageParentById[id] = parentMessageIdOf(message)
          }
          return false
        })
      : messages.filter((message: any) => messageIdOf(message) !== mid)

  const nextMessages = remainingMessages.map((message: any) => {
    if (!message || typeof message !== 'object') return message
    const parentMid = parentMessageIdOf(message)
    if (parentMid && deletedMessageIds.has(parentMid)) return { ...(message as any), parentMid: targetParentMid }
    return message
  })

  return {
    nextMessages,
    deletedMessageIds,
    deletedMessageParentById,
    targetParentMid,
  }
}

export function planDeleteMessageSubtree(messages: any[], rootMessageId: any): DeleteMessageSubtreePlan {
  const rootMid = String(rootMessageId || '').trim()
  const oldById = collectMessagesById(messages)
  const children = new Map<string, string[]>()

  for (const message of messages) {
    const id = messageIdOf(message)
    if (!id) continue
    const parentMid = parentMessageIdOf(message)
    if (!parentMid) continue
    const list = children.get(parentMid) || []
    list.push(id)
    children.set(parentMid, list)
  }

  const deletedMessageIds = new Set<string>()
  const stack = [rootMid]
  while (stack.length) {
    const current = String(stack.pop() || '').trim()
    if (!current || deletedMessageIds.has(current)) continue
    deletedMessageIds.add(current)
    for (const childId of children.get(current) || []) {
      if (childId && !deletedMessageIds.has(childId)) stack.push(childId)
    }
  }

  for (const id of Array.from(deletedMessageIds)) {
    const message = oldById.get(id) || null
    if (!message || String(message?.role || '') !== 'user') continue
    const groupId = String((message as any)?.groupId || '').trim()
    const groupRole = String((message as any)?.groupRole || '').trim()
    if (!groupId || groupRole !== 'root') continue
    const groupRootMid = messageIdOf(message)

    for (const candidate of messages) {
      if (!candidate || typeof candidate !== 'object') continue
      if (String(candidate?.role || '') !== 'user') continue
      if (String((candidate as any)?.groupId || '').trim() !== groupId) continue
      if (String((candidate as any)?.groupRole || '').trim() !== 'attachment') continue
      if (String((candidate as any)?.groupParentMid || '').trim() !== groupRootMid) continue
      const candidateId = messageIdOf(candidate)
      if (candidateId) deletedMessageIds.add(candidateId)
    }
  }

  const deletedMessageParentById: Record<string, string> = {}
  for (const id of deletedMessageIds) {
    deletedMessageParentById[id] = parentMessageIdOf(oldById.get(id))
  }

  const nextMessages = messages.filter((message: any) => {
    const id = messageIdOf(message)
    if (!id) return true
    return !deletedMessageIds.has(id)
  })

  return {
    nextMessages,
    deletedMessageIds,
    deletedMessageParentById,
    subtreeRootIds: rootMid ? [rootMid] : [],
  }
}

export function repairBranchHeadsAfterSingleMessageDeletion(chat: any, oldById: Map<string, any>, targetParentMid: string) {
  const currentMessages = Array.isArray(chat?.messages) ? (chat.messages as any[]) : []
  repairBranchHeads(chat, oldById, currentMessages, (currentById, lastMessageId) => {
    return targetParentMid && currentById.has(targetParentMid) ? targetParentMid : lastMessageId
  })
}

export function repairBranchHeadsAfterSubtreeDeletion(chat: any, oldById: Map<string, any>, nextMessages: any[]) {
  repairBranchHeads(chat, oldById, nextMessages, (_currentById, lastMessageId) => lastMessageId)
}
