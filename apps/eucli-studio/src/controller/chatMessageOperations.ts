import { now } from '../core/utils'
import { findChatMessageById } from '../domain/branching'
import { replaceMessageText, editAssistantMessageBlock, deleteAssistantMessageBlock } from '../domain/assistantMessageBlockMutations'
import type { MessageMutationOperation } from '../domain/messageMutationConflicts'
import { submitToolConfirmation as submitToolConfirmationRequest } from './ebRoleRun'
import { deleteGroupSessionMessage, deleteGroupSessionMessageSubtree, deleteRoleSessionMessage, deleteRoleSessionMessageSubtree, deleteWorkspaceSessionMessage, deleteWorkspaceSessionMessageSubtree, updateGroupSessionMessage, updateRoleSessionMessage, updateWorkspaceSessionMessage } from './ebRoleSession'
import type { createChatOperationsShared } from './chatOperationsShared'

export function createChatMessageOperations(shared: ReturnType<typeof createChatOperationsShared>) {
  const { deps, refreshTargetSession, activeTargetSessionMutationTarget, ensureTargetSessionMessageMutationAllowed } = shared
  const { getState, netRequest, showToast, render } = deps

  function chatHasPendingToolConfirmation(chat: any, messageId: string, decisionId: string) {
    const message = findChatMessageById(chat, messageId)
    const parts = Array.isArray((message as any)?.parts) ? (message as any).parts : []
    return parts.some((part: any) => {
      const decision = part?.decision && typeof part.decision === 'object' ? part.decision : null
      return String(part?.type || '') === 'tool'
        && String(part?.state || '').trim() === 'needs_confirmation'
        && String(decision?.status || '').trim() === 'needs_confirmation'
        && String(decision?.id || '').trim() === decisionId
    })
  }

  async function submitToolConfirmationDecision(input: { messageId?: string; decisionId?: string; approved?: boolean }) {
    const state = getState()
    if (state.loading || !state.data) return false
    const target = await activeTargetSessionMutationTarget()
    const messageId = String(input?.messageId || '').trim()
    const decisionId = String(input?.decisionId || '').trim()
    if (!target || !messageId || !decisionId) return false
    if (!chatHasPendingToolConfirmation(target.chat, messageId, decisionId)) {
      showToast?.('确认项已更新，请刷新会话后再试', { kind: 'error' })
      return false
    }
    if (typeof netRequest !== 'function') {
      showToast?.('e-b 请求通道不可用', { kind: 'error' })
      return false
    }
    try {
      const approved = !!input?.approved
      await submitToolConfirmationRequest(netRequest, { decisionId, approved, reason: approved ? '' : '用户拒绝工具调用' })
      showToast?.(approved ? '已同意工具执行' : '已拒绝工具执行', { kind: 'success' })
      await refreshTargetSession(target.targetKind, target.targetId, target.sessionId, undefined, { activate: false })
      render()
      return true
    } catch (e: any) {
      showToast?.(String(e?.message || e || '工具确认提交失败'), { kind: 'error' })
      render()
      return false
    }
  }

  async function applyTargetSessionMessageMutation(messageId: any, operationText: string, operation: MessageMutationOperation, mutate: (message: any) => { ok: true } | { ok: false; error: string }) {
    const state = getState()
    if (state.loading || !state.data) return false
    const target = await activeTargetSessionMutationTarget()
    const mid = String(messageId || '').trim()
    if (!target || !mid) return false
    const messages = Array.isArray(target.chat?.messages) ? target.chat.messages : []
    const message = messages.find((item: any) => String(item?.id || '').trim() === mid) || null
    if (!message) {
      showToast?.('消息不存在', { kind: 'error' })
      return false
    }
    if (!ensureTargetSessionMessageMutationAllowed(target, mid, operation)) return false
    const messageIndex = messages.indexOf(message)
    const beforeMessage = clonePlain(message)
    const beforeChatUpdatedAt = target.chat.updatedAt
    const result = mutate(message)
    if (!result.ok) {
      showToast?.(result.error, { kind: 'error' })
      return false
    }
    message.updatedAt = now()
    target.chat.updatedAt = message.updatedAt
    if (typeof netRequest !== 'function') {
      showToast?.('e-b 请求通道不可用', { kind: 'error' })
      if (messageIndex >= 0) messages[messageIndex] = beforeMessage
      target.chat.updatedAt = beforeChatUpdatedAt
      render()
      return false
    }
    try {
      if (target.targetKind === 'group') await updateGroupSessionMessage(netRequest, { groupId: target.groupId, sessionId: target.sessionId, messageId: mid, content: String(message.content ?? ''), parts: Array.isArray(message.parts) ? message.parts : [] })
      else if (target.targetKind === 'workspace') await updateWorkspaceSessionMessage(netRequest, { workspaceId: target.workspaceId, roleId: target.roleId, sessionId: target.sessionId, messageId: mid, content: String(message.content ?? ''), parts: Array.isArray(message.parts) ? message.parts : [] })
      else await updateRoleSessionMessage(netRequest, { roleId: target.roleId, sessionId: target.sessionId, messageId: mid, content: String(message.content ?? ''), parts: Array.isArray(message.parts) ? message.parts : [] })
    } catch (e: any) {
      if (messageIndex >= 0) messages[messageIndex] = beforeMessage
      target.chat.updatedAt = beforeChatUpdatedAt
      showToast?.(String(e?.message || e || `消息块${operationText}失败`), { kind: 'error' })
      render()
      return false
    }
    render()
    return true
  }

  async function deleteMessage(messageId: any) {
    const state = getState()
    if (state.loading || !state.data) return
    const target = await activeTargetSessionMutationTarget()
    const mid = String(messageId || '').trim()
    if (!target || !mid) return false
    if (!ensureTargetSessionMessageMutationAllowed(target, mid, 'delete')) return false
    if (typeof netRequest !== 'function') { showToast?.('e-b 请求通道不可用', { kind: 'error' }); return false }
    try {
      if (target.targetKind === 'group') await deleteGroupSessionMessage(netRequest, { groupId: target.groupId, sessionId: target.sessionId, messageId: mid })
      else if (target.targetKind === 'workspace') await deleteWorkspaceSessionMessage(netRequest, { workspaceId: target.workspaceId, roleId: target.roleId, sessionId: target.sessionId, messageId: mid })
      else await deleteRoleSessionMessage(netRequest, { roleId: target.roleId, sessionId: target.sessionId, messageId: mid })
      await refreshTargetSession(target.targetKind, target.targetId, target.sessionId)
      render()
      return true
    } catch (e: any) {
      showToast?.(String(e?.message || e || '消息删除失败'), { kind: 'error' })
      render()
      return false
    }
  }

  async function deleteMessageSubtree(messageId: any) {
    const state = getState()
    if (state.loading || !state.data) return
    const target = await activeTargetSessionMutationTarget()
    const mid = String(messageId || '').trim()
    if (!target || !mid) return false
    if (!ensureTargetSessionMessageMutationAllowed(target, mid, 'delete-subtree')) return false
    if (typeof netRequest !== 'function') { showToast?.('e-b 请求通道不可用', { kind: 'error' }); return false }
    try {
      if (target.targetKind === 'group') await deleteGroupSessionMessageSubtree(netRequest, { groupId: target.groupId, sessionId: target.sessionId, messageId: mid })
      else if (target.targetKind === 'workspace') await deleteWorkspaceSessionMessageSubtree(netRequest, { workspaceId: target.workspaceId, roleId: target.roleId, sessionId: target.sessionId, messageId: mid })
      else await deleteRoleSessionMessageSubtree(netRequest, { roleId: target.roleId, sessionId: target.sessionId, messageId: mid })
      await refreshTargetSession(target.targetKind, target.targetId, target.sessionId)
      render()
      return true
    } catch (e: any) {
      showToast?.(String(e?.message || e || '消息删除失败'), { kind: 'error' })
      render()
      return false
    }
  }

  async function editMessage(messageId: any, content: any) {
    return applyTargetSessionMessageMutation(messageId, '编辑', 'edit', (message) => replaceMessageText(message, content))
  }

  async function editMessageBlock(messageId: any, blockRef: any, text: any) {
    return applyTargetSessionMessageMutation(messageId, '编辑', 'edit', (message) => editAssistantMessageBlock(message, blockRef, text))
  }

  async function deleteMessageBlock(messageId: any, blockRef: any) {
    return applyTargetSessionMessageMutation(messageId, '删除', 'delete', (message) => deleteAssistantMessageBlock(message, blockRef))
  }

  return {
    submitToolConfirmationDecision,
    deleteMessage,
    deleteMessageSubtree,
    editMessage,
    editMessageBlock,
    deleteMessageBlock,
  }
}

function clonePlain<T>(value: T): T {
  try {
    return JSON.parse(JSON.stringify(value))
  } catch (_) {
    return value
  }
}
