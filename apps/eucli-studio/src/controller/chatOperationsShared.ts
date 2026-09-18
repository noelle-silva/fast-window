import { createStateAccessors } from '../state/stateAccessors'
import { activeEbRunCardsForTarget } from '../domain/activeRunCards'
import { messageMutationConflict, type MessageMutationOperation } from '../domain/messageMutationConflicts'
import { parseWorkspaceRoleTargetId, workspaceRoleTargetId } from '../domain/workspaceRoleTarget'
import type { AiChatShowToast } from '../gateway/capabilities'
import type { ModelRef } from '../domain/modelRefUtils'
import type { EbRunState } from './ebRoleRun'

export type ChatTargetKind = 'role' | 'group' | 'workspace'

export type SendChatOptions = {
  forkFromMid?: string
  onRunState?: (run: EbRunState) => void
}

export type ExistingMessageRunOptions = {
  onRunState?: (run: EbRunState) => void
}

export type RoleRunInput = {
  roleId: string
  groupId?: string
  workspaceId?: string
  sessionId: string
  message?: string
  attachments?: any[]
  parentMessageId?: string
  userMessageId?: string
  contextMessageId?: string
  reasoningEffort?: string
  modelOverride?: ModelRef | null
  hookPromptMode?: string
  hookPromptPresetId?: string
  stream?: boolean
}

export type ChatOperationsDeps = {
  getState: () => any
  pickImageFiles?: (maxCount: number) => Promise<any[]>
  netRequest?: (req: any) => Promise<any>
  showToast?: AiChatShowToast
  save: () => Promise<void>
  ensureActiveChatLoaded?: () => Promise<any>
  ensureChatLoaded?: (kind: 'role' | 'group' | 'workspace', targetId: string, chatId: string) => Promise<any>
  reloadRoleSession?: (roleId: string, sessionId: string) => Promise<any>
  reloadGroupSession?: (groupId: string, sessionId: string) => Promise<any>
  reloadWorkspaceSession?: (workspaceId: string, sessionId: string) => Promise<any>
  waitForChatSettingsSave?: () => Promise<void>
  emit: () => void
  render: () => void
  renderComposer: () => void
  scrollToBottomSoon: () => void
  readImageFileAsDataUrl: (file: File) => Promise<string>
  extractTextFromFile: (file: File, kind: string) => Promise<string>
}

export function createChatOperationsShared(deps: ChatOperationsDeps) {
  const { getState, showToast, ensureChatLoaded, reloadRoleSession, reloadGroupSession, reloadWorkspaceSession, ensureActiveChatLoaded, emit } = deps

  const sa = createStateAccessors({ getState })
  const cancelledRunIds = new Set<string>()
  const startingRoleRunKeys = new Set<string>()

  function splitWorkspaceTargetId(targetIdRaw: unknown) {
    const parsed = parseWorkspaceRoleTargetId(targetIdRaw)
    if (parsed.workspaceId && parsed.roleId) return parsed
    return { workspaceId: String(targetIdRaw || '').trim(), roleId: String(sa.activeRole()?.id || '').trim() }
  }

  async function refreshRoleSession(roleId: string, sessionId: string, onLoaded?: (chat: any) => void, options?: { activate?: boolean }) {
    return refreshTargetSession('role', roleId, sessionId, onLoaded, options)
  }

  async function refreshTargetSession(targetKind: ChatTargetKind, targetId: string, sessionId: string, onLoaded?: (chat: any) => void, options?: { activate?: boolean }) {
    const state = getState()
    const tid = String(targetId || '').trim()
    const sid = String(sessionId || '').trim()
    if (!state.data || !tid || !sid || typeof ensureChatLoaded !== 'function') return null
    const workspaceTarget = targetKind === 'workspace' ? splitWorkspaceTargetId(tid) : { workspaceId: '', roleId: '' }
    if (targetKind === 'group') {
      if (!state.data.chatsByGroup || typeof state.data.chatsByGroup !== 'object') state.data.chatsByGroup = {}
      if (!state.data.chatsByGroup[tid] || typeof state.data.chatsByGroup[tid] !== 'object') state.data.chatsByGroup[tid] = { activeChatId: '', chatMetas: [], chats: [] }
    } else if (targetKind === 'workspace') {
      if (!state.data.chatsByWorkspace || typeof state.data.chatsByWorkspace !== 'object') state.data.chatsByWorkspace = {}
      if (!state.data.chatsByWorkspace[tid] || typeof state.data.chatsByWorkspace[tid] !== 'object') state.data.chatsByWorkspace[tid] = { activeChatId: '', chatMetas: [], chats: [] }
    } else {
      if (!state.data.chatsByRole || typeof state.data.chatsByRole !== 'object') state.data.chatsByRole = {}
      if (!state.data.chatsByRole[tid] || typeof state.data.chatsByRole[tid] !== 'object') state.data.chatsByRole[tid] = { activeChatId: '', chatMetas: [], chats: [] }
    }
    const chat = targetKind === 'group'
      ? typeof reloadGroupSession === 'function'
        ? await reloadGroupSession(tid, sid)
        : await ensureChatLoaded('group', tid, sid)
      : targetKind === 'workspace'
        ? typeof reloadWorkspaceSession === 'function'
          ? await reloadWorkspaceSession(workspaceTarget.workspaceId, sid)
          : await ensureChatLoaded('workspace', workspaceTarget.workspaceId, sid)
      : typeof reloadRoleSession === 'function'
        ? await reloadRoleSession(tid, sid)
        : await ensureChatLoaded('role', tid, sid)
    if (chat) {
      if (options?.activate !== false) {
        if (targetKind === 'group') state.data.chatsByGroup[tid].activeChatId = sid
        else if (targetKind === 'workspace') state.data.chatsByWorkspace[tid].activeChatId = sid
        else state.data.chatsByRole[tid].activeChatId = sid
      }
      onLoaded?.(chat)
      emit()
    }
    return chat
  }

  async function activeSingleRoleTarget() {
    const target = await activeTargetSessionMutationTarget()
    if (!target || target.targetKind === 'group' || !target.roleId) return null
    return target
  }

  async function activeTargetSessionMutationTarget() {
    const activeKind = sa.activeTargetKind()
    const targetKind: ChatTargetKind = activeKind === 'group' ? 'group' : activeKind === 'workspace' ? 'workspace' : 'role'
    const target = targetKind === 'group' ? sa.activeGroup() : targetKind === 'workspace' ? sa.activeWorkspace?.() : sa.activeRole()
    const chat = await ensureActiveChatLoaded?.().catch(() => null) || sa.activeChatFromData()
    const workspaceId = targetKind === 'workspace' ? String(target?.id || '').trim() : ''
    const sessionId = String(chat?.id || '').trim()
    const roleId = String(sa.activeRole()?.id || '').trim()
    const targetId = targetKind === 'workspace' ? workspaceRoleTargetId(workspaceId, roleId) : String(target?.id || '').trim()
    if (!targetId || !sessionId || !chat) return null
    return {
      targetKind,
      targetId,
      roleId: targetKind === 'group' ? '' : targetKind === 'workspace' ? roleId : targetId,
      groupId: targetKind === 'group' ? targetId : '',
      workspaceId,
      sessionId,
      chat,
    }
  }

  function ensureTargetSessionMessageMutationAllowed(target: { targetKind: ChatTargetKind; targetId: string; sessionId: string; chat: any }, messageId: string, operation: MessageMutationOperation) {
    const conflict = messageMutationConflict(target.chat, messageId, { operation, activeRunCards: activeEbRunCardsForTarget(getState(), target.targetKind, target.targetId, target.sessionId) })
    if (!conflict.blocked) return true
    showToast?.(conflict.reason || '这条消息正在被运行中的回复使用，稍后再操作', { kind: 'error' })
    return false
  }

  return {
    deps,
    sa,
    cancelledRunIds,
    startingRoleRunKeys,
    splitWorkspaceTargetId,
    refreshRoleSession,
    refreshTargetSession,
    activeSingleRoleTarget,
    activeTargetSessionMutationTarget,
    ensureTargetSessionMessageMutationAllowed,
  }
}
