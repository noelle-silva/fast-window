import { CHAT_DEFAULT_BRANCH_ID } from './constants'
import { normalizeBranchId } from './branching'
import { assistantRunGenerationId, isAssistantGenerating } from './assistantRunState'

export type ActiveAssistantMessageRef = {
  message: any
  mid: string
  branchId: string
  generationId: string
  index: number
}

export type ActiveAssistantMessageFilter = {
  branchId?: any
  excludeMid?: any
}

export function listActiveAssistantMessages(chat: any, filter?: ActiveAssistantMessageFilter): ActiveAssistantMessageRef[] {
  const messages = Array.isArray(chat?.messages) ? chat.messages : []
  const branchFilter = filter && Object.prototype.hasOwnProperty.call(filter, 'branchId')
    ? normalizeBranchId(filter.branchId || CHAT_DEFAULT_BRANCH_ID)
    : ''
  const excludeMid = String(filter?.excludeMid || '').trim()
  const out: ActiveAssistantMessageRef[] = []

  for (let index = 0; index < messages.length; index++) {
    const message = messages[index]
    if (!message || typeof message !== 'object') continue
    if (message.role !== 'assistant') continue
    if (!isAssistantGenerating(message)) continue

    const mid = String(message.id || '').trim()
    if (!mid) continue
    if (excludeMid && mid === excludeMid) continue

    const branchId = normalizeBranchId(message.branchId || CHAT_DEFAULT_BRANCH_ID)
    if (branchFilter && branchId !== branchFilter) continue

    out.push({
      message,
      mid,
      branchId,
      generationId: assistantRunGenerationId(message),
      index,
    })
  }

  return out
}

export function hasActiveAssistantMessages(chat: any, filter?: ActiveAssistantMessageFilter) {
  return listActiveAssistantMessages(chat, filter).length > 0
}

export function lastActiveAssistantMessage(chat: any, filter?: ActiveAssistantMessageFilter) {
  const refs = listActiveAssistantMessages(chat, filter)
  return refs.length ? refs[refs.length - 1] : null
}
