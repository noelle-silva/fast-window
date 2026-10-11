import { now } from '../core/utils'
import { activeEbRunCardsForTarget } from '../domain/activeRunCards'
import { createMessageMutationGuard } from '../domain/messageMutationConflicts'
import {
  cleanMessageReasoningParts,
  parseReasoningCleanKeywords,
} from '../domain/reasoningCleaning'
import {
  updateGroupSessionMessage,
  updateRoleSessionMessage,
  updateWorkspaceSessionMessage,
} from './ebRoleSession'
import type { createChatOperationsShared } from './chatOperationsShared'

type ReasoningCleanTarget = {
  targetKind: 'role' | 'group' | 'workspace'
  targetId: string
  roleId: string
  groupId: string
  workspaceId: string
  sessionId: string
  chat: any
}

// 思维链清洗的两个能力：清洗整个会话 / 清洗单条消息。
// 只动思维链，正文与其他内容不碰；会话正在运行时拒绝清洗。
export function createReasoningCleaningOperations(shared: ReturnType<typeof createChatOperationsShared>) {
  const { deps, activeTargetSessionMutationTarget, refreshTargetSession } = shared
  const { getState, netRequest, showToast, render } = deps

  function sessionRunning(target: ReasoningCleanTarget) {
    return activeEbRunCardsForTarget(getState(), target.targetKind, target.targetId, target.sessionId).length > 0
  }

  async function persistMessage(target: ReasoningCleanTarget, message: any) {
    if (typeof netRequest !== 'function') throw new Error('e-b 请求通道不可用')
    const payload = {
      messageId: String(message?.id || '').trim(),
      content: String(message?.content ?? ''),
      parts: Array.isArray(message?.parts) ? message.parts : [],
    }
    if (target.targetKind === 'group') await updateGroupSessionMessage(netRequest, { groupId: target.groupId, sessionId: target.sessionId, ...payload })
    else if (target.targetKind === 'workspace') await updateWorkspaceSessionMessage(netRequest, { workspaceId: target.workspaceId, roleId: target.roleId, sessionId: target.sessionId, ...payload })
    else await updateRoleSessionMessage(netRequest, { roleId: target.roleId, sessionId: target.sessionId, ...payload })
  }

  async function refreshAfterClean(target: ReasoningCleanTarget) {
    await refreshTargetSession(target.targetKind, target.targetId, target.sessionId, undefined, { activate: false })
    render()
  }

  function resolveKeywords(keywordsRaw: unknown): string[] {
    const keywords = parseReasoningCleanKeywords(keywordsRaw)
    if (!keywords.length) showToast?.('请至少输入一个关键词', { kind: 'error' })
    return keywords
  }

  async function cleanMessageReasoning(messageIdRaw: unknown, keywordsRaw: unknown) {
    const state = getState()
    if (state.loading || !state.data) return false
    const keywords = resolveKeywords(keywordsRaw)
    if (!keywords.length) return false
    const target = await activeTargetSessionMutationTarget()
    const mid = String(messageIdRaw || '').trim()
    if (!target || !mid) return false
    if (sessionRunning(target)) {
      showToast?.('会话正在运行，暂不能清洗思维链', { kind: 'error' })
      return false
    }
    const messages = Array.isArray(target.chat?.messages) ? target.chat.messages : []
    const message = messages.find((item: any) => String(item?.id || '') === mid) || null
    if (!message) {
      showToast?.('消息不存在', { kind: 'error' })
      return false
    }
    const conflict = createMessageMutationGuard(target.chat).conflict(mid, 'edit')
    if (conflict.blocked) {
      showToast?.(conflict.reason || '这条消息不能被清洗', { kind: 'error' })
      return false
    }
    const beforeMessage = clonePlain(message)
    const beforeChatUpdatedAt = target.chat.updatedAt
    if (!cleanMessageReasoningParts(message, keywords)) {
      showToast?.('没有命中的关键词')
      return false
    }
    message.updatedAt = now()
    target.chat.updatedAt = message.updatedAt
    try {
      await persistMessage(target, message)
    } catch (e: any) {
      const index = messages.indexOf(message)
      if (index >= 0) messages[index] = beforeMessage
      target.chat.updatedAt = beforeChatUpdatedAt
      showToast?.(String(e?.message || e || '思维链清洗失败'), { kind: 'error' })
      render()
      return false
    }
    await refreshAfterClean(target)
    showToast?.('思维链已清洗', { kind: 'success' })
    return true
  }

  async function cleanSessionReasoning(keywordsRaw: unknown) {
    const state = getState()
    if (state.loading || !state.data) return false
    const keywords = resolveKeywords(keywordsRaw)
    if (!keywords.length) return false
    const target = await activeTargetSessionMutationTarget()
    if (!target) return false
    if (sessionRunning(target)) {
      showToast?.('会话正在运行，暂不能清洗思维链', { kind: 'error' })
      return false
    }
    const messages = Array.isArray(target.chat?.messages) ? target.chat.messages : []
    // 不能被编辑的消息（压缩摘要覆盖的历史、系统控制）跳过：它们本来就不能改。
    const guard = createMessageMutationGuard(target.chat)
    const editable = messages.filter((message: any) => {
      const id = String(message?.id || '').trim()
      return id && !guard.blocked(id, 'edit')
    })
    const changed = editable.filter((message: any) => cleanMessageReasoningParts(message, keywords))
    if (!changed.length) {
      showToast?.('没有命中的关键词')
      return false
    }
    try {
      for (const message of changed) {
        message.updatedAt = now()
        await persistMessage(target, message)
      }
    } catch (e: any) {
      showToast?.(String(e?.message || e || '思维链清洗失败'), { kind: 'error' })
      await refreshAfterClean(target)
      return false
    }
    await refreshAfterClean(target)
    showToast?.('思维链已清洗', { kind: 'success' })
    return true
  }

  return { cleanMessageReasoning, cleanSessionReasoning }
}

function clonePlain<T>(value: T): T {
  try {
    return JSON.parse(JSON.stringify(value))
  } catch (_) {
    return value
  }
}
