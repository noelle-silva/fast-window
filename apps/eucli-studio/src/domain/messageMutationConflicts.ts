import type { EbRoleRunCard } from './activeRunCards'
import { isSystemControlMessage } from './message'

export type MessageMutationOperation = 'edit' | 'delete' | 'delete-subtree'

export type MessageMutationConflict = {
  blocked: boolean
  reason: string
  messageId: string
  runId: string
}

function text(value: unknown) {
  return String(value || '').trim()
}

function chatMessages(chat: any) {
  return Array.isArray(chat?.messages) ? chat.messages : []
}

function buildMessageTree(chat: any) {
  const messages = chatMessages(chat)
  const byId = new Map<string, any>()
  const children = new Map<string, string[]>()

  for (const message of messages) {
    const id = text(message?.id)
    if (!id || byId.has(id)) continue
    byId.set(id, message)
  }

  for (const message of messages) {
    const id = text(message?.id)
    const parentId = text(message?.parentMid || message?.parentMessageId)
    if (!id || !parentId || !byId.has(parentId)) continue
    const list = children.get(parentId) || []
    list.push(id)
    children.set(parentId, list)
  }

  return { byId, children }
}

function collectSubtreeIds(children: Map<string, string[]>, rootId: string) {
  const ids = new Set<string>()
  const stack = [rootId]
  while (stack.length) {
    const id = text(stack.pop())
    if (!id || ids.has(id)) continue
    ids.add(id)
    for (const childId of children.get(id) || []) stack.push(childId)
  }
  return ids
}

function activeRunMessageIds(cards: EbRoleRunCard[]) {
  const out: Array<{ id: string; runId: string }> = []
  for (const card of cards) {
    const runId = text(card?.runId)
    const ids = [card?.inputMessageId, card?.anchorMessageId, card?.lastMessageId, ...(Array.isArray(card?.dependencyMessageIds) ? card.dependencyMessageIds : [])].map(text).filter(Boolean)
    for (const id of ids) out.push({ id, runId })
  }
  return out
}

function operationReason(operation: MessageMutationOperation) {
  if (operation === 'edit') return '这条消息正在被运行中的回复依赖，等对应任务结束后再编辑'
  if (operation === 'delete-subtree') return '这棵消息分支里还有运行中的回复，等对应任务结束后再删除'
  return '这条消息正在被运行中的回复依赖，等对应任务结束后再删除'
}

function compressedSourceMessageIds(messages: any[]) {
  const byId = new Map<string, any>()
  for (const message of messages) {
    const id = text(message?.id)
    if (id && !byId.has(id)) byId.set(id, message)
  }

  const protectedIds = new Set<string>()
  for (const message of messages) {
    if (!isSystemControlMessage(message) || text(message?.control?.kind) !== 'compression_summary') continue
    let current = text(message?.control?.compressedUntilMessageId)
    const seen = new Set<string>()
    while (current && !seen.has(current)) {
      seen.add(current)
      const item = byId.get(current)
      if (!item) break
      if (isSystemControlMessage(item) && text(item?.control?.kind) === 'compression_summary') break
      protectedIds.add(current)
      current = text(item?.parentMid || item?.parentMessageId)
    }
  }
  return protectedIds
}

function staticMutationBlockReason(chat: any, targetMessageId: string, operation: MessageMutationOperation) {
  const tree = buildMessageTree(chat)
  const target = tree.byId.get(targetMessageId)
  if (!target) return ''

  const affectedIds = operation === 'delete-subtree' ? collectSubtreeIds(tree.children, targetMessageId) : new Set<string>([targetMessageId])
  const sourceIds = compressedSourceMessageIds(Array.from(tree.byId.values()))

  for (const id of affectedIds) {
    const message = tree.byId.get(id)
    if (isSystemControlMessage(message)) return '压缩标记和摘要不能被普通编辑或删除'
    if (sourceIds.has(id)) return '已被上下文摘要覆盖的历史消息不能被普通编辑或删除'
  }
  return ''
}

export function messageMutationConflict(
  chat: any,
  targetMessageId: unknown,
  options?: { operation?: MessageMutationOperation; activeRunCards?: EbRoleRunCard[] },
): MessageMutationConflict {
  const targetId = text(targetMessageId)
  const operation = options?.operation || 'edit'
  if (!chat || !targetId) return { blocked: false, reason: '', messageId: targetId, runId: '' }

  const tree = buildMessageTree(chat)
  if (!tree.byId.has(targetId)) return { blocked: false, reason: '', messageId: targetId, runId: '' }

  const staticReason = staticMutationBlockReason(chat, targetId, operation)
  if (staticReason) return { blocked: true, reason: staticReason, messageId: targetId, runId: '' }

  const affectedIds = collectSubtreeIds(tree.children, targetId)
  const cards = Array.isArray(options?.activeRunCards) ? options.activeRunCards : []
  for (const item of activeRunMessageIds(cards)) {
    if (affectedIds.has(item.id)) return { blocked: true, reason: operationReason(operation), messageId: item.id, runId: item.runId }
  }

  return { blocked: false, reason: '', messageId: targetId, runId: '' }
}

export function createMessageMutationGuard(chat: any, options?: { activeRunCards?: EbRoleRunCard[] }) {
  const tree = buildMessageTree(chat)
  const runRefs = activeRunMessageIds(Array.isArray(options?.activeRunCards) ? options.activeRunCards : [])

  return {
    conflict(targetMessageId: unknown, operation: MessageMutationOperation = 'edit'): MessageMutationConflict {
      const targetId = text(targetMessageId)
      if (!chat || !targetId) return { blocked: false, reason: '', messageId: targetId, runId: '' }
      if (!tree.byId.has(targetId)) return { blocked: false, reason: '', messageId: targetId, runId: '' }

      const staticReason = staticMutationBlockReason(chat, targetId, operation)
      if (staticReason) return { blocked: true, reason: staticReason, messageId: targetId, runId: '' }

      const affectedIds = collectSubtreeIds(tree.children, targetId)
      for (const item of runRefs) {
        if (affectedIds.has(item.id)) return { blocked: true, reason: operationReason(operation), messageId: item.id, runId: item.runId }
      }

      return { blocked: false, reason: '', messageId: targetId, runId: '' }
    },
    blocked(targetMessageId: unknown, operation: MessageMutationOperation = 'edit') {
      return this.conflict(targetMessageId, operation).blocked
    },
  }
}

export function canMutateMessage(chat: any, targetMessageId: unknown, options?: { operation?: MessageMutationOperation; activeRunCards?: EbRoleRunCard[] }) {
  return !messageMutationConflict(chat, targetMessageId, options).blocked
}
