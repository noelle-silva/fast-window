import { preserveLocalBranchSelection } from './branching'
import { hasAssistantVisibleOutput, isAssistantGenerating, resolveAssistantMessageForMerge } from './assistantRunState'
import { CHAT_MESSAGE_TYPE_ASYNC_TOOL_RESULT, chatMessageMaterialKind, isAssistantTextChatMessage } from './message'

function messageId(value: any) {
  return String(value?.id || '').trim()
}

function hasSameMaterialKind(left: any, right: any) {
  return chatMessageMaterialKind(left) === chatMessageMaterialKind(right)
}

function resolveMaterialIdentityConflict(currentMessage: any, storedMessage: any) {
  const currentKind = chatMessageMaterialKind(currentMessage)
  const storedKind = chatMessageMaterialKind(storedMessage)
  if (currentKind === CHAT_MESSAGE_TYPE_ASYNC_TOOL_RESULT) return currentMessage
  if (storedKind === CHAT_MESSAGE_TYPE_ASYNC_TOOL_RESULT) return storedMessage
  return storedMessage
}

function shouldPreserveRuntimeOnlyMessage(message: any) {
  const kind = chatMessageMaterialKind(message)
  if (kind === CHAT_MESSAGE_TYPE_ASYNC_TOOL_RESULT) return true
  return isAssistantTextChatMessage(message) && isAssistantGenerating(message) && hasAssistantVisibleOutput(message)
}

function setBranchHeadMid(chat: any, branchId: string, headMid: string) {
  const branches = Array.isArray(chat?.branching?.branches) ? chat.branching.branches : []
  const branch = branches.find((item: any) => String(item?.id || '').trim() === branchId) || null
  if (!branch) return
  branch.headMid = headMid
  branch.updatedAt = Number(chat?.updatedAt || branch.updatedAt || 0)
}

function preserveRuntimeBranchHeads(nextChat: any, currentChat: any) {
  const nextMessages = Array.isArray(nextChat?.messages) ? nextChat.messages : []
  const nextIds = new Set(nextMessages.map((message: any) => messageId(message)).filter(Boolean))
  const branches = Array.isArray(currentChat?.branching?.branches) ? currentChat.branching.branches : []
  const currentMessages = Array.isArray(currentChat?.messages) ? currentChat.messages : []
  const currentById = new Map<string, any>()
  for (const message of currentMessages) {
    const id = messageId(message)
    if (id && !currentById.has(id)) currentById.set(id, message)
  }
  for (const branch of branches) {
    const branchId = String(branch?.id || '').trim()
    const headMid = String(branch?.headMid || '').trim()
    if (!branchId || !headMid || !nextIds.has(headMid)) continue
    const currentHead = currentById.get(headMid) || null
    if (!shouldPreserveRuntimeOnlyMessage(currentHead)) continue
    setBranchHeadMid(nextChat, branchId, headMid)
  }
}

function mergeMessagesFromStorage(nextChat: any, currentChat: any) {
  const nextMessages = Array.isArray(nextChat?.messages) ? nextChat.messages : null
  const currentMessages = Array.isArray(currentChat?.messages) ? currentChat.messages : null
  if (!nextMessages || !currentMessages || !currentMessages.length) return

  const currentById = new Map<string, any>()
  for (const message of currentMessages) {
    const id = messageId(message)
    if (id && !currentById.has(id)) currentById.set(id, message)
  }

  nextChat.messages = nextMessages.map((storedMessage: any) => {
    const currentMessage = currentById.get(messageId(storedMessage)) || null
    if (!currentMessage) return storedMessage
    if (!hasSameMaterialKind(currentMessage, storedMessage)) return resolveMaterialIdentityConflict(currentMessage, storedMessage)
    if (!isAssistantTextChatMessage(currentMessage) || !isAssistantTextChatMessage(storedMessage)) return storedMessage
    if (!isAssistantGenerating(currentMessage) && !isAssistantGenerating(storedMessage)) return storedMessage
    return resolveAssistantMessageForMerge(currentMessage, storedMessage, { storedChatStatus: nextChat?.status })
  })

  const nextIds = new Set(nextChat.messages.map((message: any) => messageId(message)).filter(Boolean))
  for (const currentMessage of currentMessages) {
    const id = messageId(currentMessage)
    if (!id || nextIds.has(id)) continue
    if (!shouldPreserveRuntimeOnlyMessage(currentMessage)) continue
    nextChat.messages.push(currentMessage)
    nextIds.add(id)
  }
  preserveRuntimeBranchHeads(nextChat, currentChat)
}

export function mergeChatFromStorage(nextChat: any, currentChat: any) {
  const next = preserveLocalBranchSelection(nextChat, currentChat)
  if (!next || !currentChat || typeof next !== 'object' || typeof currentChat !== 'object') return next
  mergeMessagesFromStorage(next, currentChat)
  if ((next as any).runtimePartial) delete (next as any).runtimePartial
  return next
}

export function isStoredChatNewerThanCurrent(storedUpdatedAtRaw: any, currentUpdatedAtRaw: any) {
  const storedUpdatedAt = Number(storedUpdatedAtRaw || 0)
  const currentUpdatedAt = Number(currentUpdatedAtRaw || 0)
  if (!Number.isFinite(storedUpdatedAt) || storedUpdatedAt <= 0) return false
  if (!Number.isFinite(currentUpdatedAt) || currentUpdatedAt <= 0) return true
  return storedUpdatedAt > currentUpdatedAt
}
