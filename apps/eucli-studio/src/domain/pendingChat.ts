import { now, uid } from '../core/utils'
import { parseWorkspaceRoleTargetId, workspaceRoleTargetId } from './workspaceRoleTarget'

export type PendingChatTargetKind = 'role' | 'group' | 'workspace'

export type PendingChatEntry = {
  chat: any
  roleId?: string
  groupId?: string
  workspaceId?: string
}

function normalizeId(value: unknown): string {
  return String(value || '').trim()
}

export function createPendingChatEntry(kind: PendingChatTargetKind, targetIdRaw: unknown, fallbackTitle: string, roleIdRaw?: unknown): PendingChatEntry | null {
  const targetId = normalizeId(targetIdRaw)
  const roleId = normalizeId(roleIdRaw)
  if (!targetId) return null
  const ts = now()
  const chat = {
    id: uid('draft-chat'),
    title: String(fallbackTitle || '').trim() || (kind === 'group' ? '群聊' : '新聊天'),
    messages: [],
    createdAt: ts,
    updatedAt: ts,
    clientDraft: true,
  }
  if (kind === 'group') return { groupId: targetId, chat }
  if (kind === 'workspace') {
    if (!roleId) return null
    return { workspaceId: targetId, roleId, chat }
  }
  return { roleId: targetId, chat }
}

export function pendingChatForTarget(state: any, kind: PendingChatTargetKind, targetIdRaw: unknown) {
  const targetId = normalizeId(targetIdRaw)
  if (!state || !targetId) return null
  const pending = kind === 'group' ? state.pendingGroupChat : kind === 'workspace' ? state.pendingWorkspaceChat : state.pendingChat
  if (!pending || typeof pending !== 'object') return null
  if (kind === 'workspace') {
    const parsed = parseWorkspaceRoleTargetId(targetId)
    if (parsed.workspaceId && parsed.roleId) {
      if (workspaceRoleTargetId(pending.workspaceId, pending.roleId) !== targetId) return null
    } else if (normalizeId(pending.workspaceId) !== targetId) {
      return null
    }
  } else {
    const pendingTargetId = kind === 'group' ? normalizeId(pending.groupId) : normalizeId(pending.roleId)
    if (pendingTargetId !== targetId) return null
  }
  return pending.chat && typeof pending.chat === 'object' ? pending.chat : null
}

export function clearPendingChatForTarget(state: any, kind: PendingChatTargetKind, targetIdRaw: unknown) {
  const targetId = normalizeId(targetIdRaw)
  if (!state || !targetId) return
  if (kind === 'group') {
    if (state.pendingGroupChat && normalizeId(state.pendingGroupChat.groupId) === targetId) state.pendingGroupChat = null
    return
  }
  if (kind === 'workspace') {
    const parsed = parseWorkspaceRoleTargetId(targetId)
    if (parsed.workspaceId && parsed.roleId) {
      if (state.pendingWorkspaceChat && workspaceRoleTargetId(state.pendingWorkspaceChat.workspaceId, state.pendingWorkspaceChat.roleId) === targetId) state.pendingWorkspaceChat = null
    } else if (state.pendingWorkspaceChat && normalizeId(state.pendingWorkspaceChat.workspaceId) === targetId) {
      state.pendingWorkspaceChat = null
    }
    return
  }
  if (state.pendingChat && normalizeId(state.pendingChat.roleId) === targetId) state.pendingChat = null
}

export function activateResolvedPendingChat(state: any, kind: PendingChatTargetKind, targetIdRaw: unknown, chatIdRaw: unknown, expectedPendingChatIdRaw?: unknown) {
  const targetId = normalizeId(targetIdRaw)
  const chatId = normalizeId(chatIdRaw)
  const expectedPendingChatId = normalizeId(expectedPendingChatIdRaw)
  if (!state?.data || !targetId || !chatId) return false
  const pendingChat = pendingChatForTarget(state, kind, targetId)
  if (!pendingChat) return false
  if (expectedPendingChatId && normalizeId(pendingChat.id) !== expectedPendingChatId) return false
  clearPendingChatForTarget(state, kind, targetId)

  if (kind === 'group') {
    if (!state.data.chatsByGroup || typeof state.data.chatsByGroup !== 'object') state.data.chatsByGroup = {}
    if (!state.data.chatsByGroup[targetId] || typeof state.data.chatsByGroup[targetId] !== 'object') state.data.chatsByGroup[targetId] = { activeChatId: '', chatMetas: [], chats: [] }
    state.data.chatsByGroup[targetId].activeChatId = chatId
    return true
  }

  if (kind === 'workspace') {
    if (!state.data.chatsByWorkspace || typeof state.data.chatsByWorkspace !== 'object') state.data.chatsByWorkspace = {}
    if (!state.data.chatsByWorkspace[targetId] || typeof state.data.chatsByWorkspace[targetId] !== 'object') state.data.chatsByWorkspace[targetId] = { activeChatId: '', chatMetas: [], chats: [] }
    state.data.chatsByWorkspace[targetId].activeChatId = chatId
    return true
  }

  if (!state.data.chatsByRole || typeof state.data.chatsByRole !== 'object') state.data.chatsByRole = {}
  if (!state.data.chatsByRole[targetId] || typeof state.data.chatsByRole[targetId] !== 'object') state.data.chatsByRole[targetId] = { activeChatId: '', chatMetas: [], chats: [] }
  state.data.chatsByRole[targetId].activeChatId = chatId
  return true
}
