import { createStateAccessors } from '../state/stateAccessors'
import { activeEbRunCardsForTarget } from '../domain/activeRunCards'
import { messageMutationConflict, type MessageMutationOperation } from '../domain/messageMutationConflicts'
import { parseWorkspaceRoleTargetId, workspaceRoleTargetId } from '../domain/workspaceRoleTarget'
import { activeChatIdExistsInBox, readActiveChatSelection, writeActiveChatSelection } from '../domain/activeChatSelection'
import { activateResolvedPendingChat } from '../domain/pendingChat'
import type { AiChatShowToast } from '../gateway/capabilities'
import type { ModelRef } from '../domain/modelRefUtils'
import type { EbRunState } from './ebRoleRun'
import type { RunProbe } from './runProbe'
import type { SessionWriteGuard } from '../storage/sessionWriteGuard'
import { refreshScopes } from '../domain/uiRefreshScope'

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
  ensureActiveChatLoaded?: () => Promise<any>
  ensureChatLoaded?: (kind: 'role' | 'group', targetId: string, chatId: string) => Promise<any>
  ensureWorkspaceChatLoaded?: (workspaceId: string, roleId: string, chatId: string) => Promise<any>
  reloadRoleSession?: (roleId: string, sessionId: string) => Promise<any>
  reloadGroupSession?: (groupId: string, sessionId: string) => Promise<any>
  reloadWorkspaceSession?: (workspaceId: string, roleId: string, sessionId: string) => Promise<any>
  // 写路径之后的正文失效：编辑 / 删除 / 运行落盘都必须经过它。
  // 只失效不重取——重取由紧接着的读取路径负责，一次写只产生一次读。
  invalidateChatBody?: (scope: { kind: 'role' | 'group'; targetId: string }, chatId: string) => void
  waitForChatSettingsSave?: () => Promise<void>
  // 写路径快照：PATCH 前用 profile=edit 取完整 parts（view 是被裁剪的视图）。
  loadEditSnapshot?: (kind: 'role' | 'group', targetId: string, chatId: string) => Promise<any | null>
  // 视图回写：把「用户在看哪条路径」变成服务端事实（design-4 决策 3）。
  // 只改视图，不改任何消息内容；后端不支持时静默跳过（本地分支状态仍然有效）。
  persistSessionView?: (kind: 'role' | 'group', targetId: string, chatId: string, head: string, branchId: string) => Promise<void>
  // pending 会话落成真实会话后：把「用户选中了它」交给与普通点击相同的偏好持久化入口。
  persistActiveChatSelection?: (kind: 'role' | 'group', targetId: string, chatId: string) => Promise<void>
  emitScope: (scope: string) => void
  render: () => void
  renderComposer: () => void
  emitComposerScope?: () => void
  scrollToBottomSoon: () => void
  readImageFileAsDataUrl: (file: File) => Promise<string>
  // RunProbe：run 终态对账的唯一入口（取代 450ms 固定轮询）。
  runProbe?: RunProbe
  // 会话写回代数：删除会话之后，旧刷新不得回写正文 / 选中事实。
  sessionWrites?: SessionWriteGuard
}

export function createChatOperationsShared(deps: ChatOperationsDeps) {
  const { getState, showToast, ensureChatLoaded, ensureWorkspaceChatLoaded, reloadRoleSession, reloadGroupSession, reloadWorkspaceSession, ensureActiveChatLoaded } = deps

  const sa = createStateAccessors({ getState })
  const cancelledRunIds = new Set<string>()
  const startingRoleRunKeys = new Set<string>()

  function splitWorkspaceTargetId(targetIdRaw: unknown) {
    return parseWorkspaceRoleTargetId(targetIdRaw)
  }

  // invalidateChatBodyAfterWrite 是「写成功之后」的唯一正文失效原语。
  //
  // 只失效、不重取：重取由紧接着的读取路径负责（reload*Session / loadStoredChat），
  // 这样一次写只产生一次读。若在这里重取，refreshTargetSession 会先取一次、
  // reload 再取一次，白打一次业务端。
  //
  // 工作区会话不走 scope 化正文缓存，直接跳过。
  function invalidateChatBodyAfterWrite(targetKind: ChatTargetKind, targetId: string, sessionId: string) {
    if (targetKind === 'workspace') return
    const tid = String(targetId || '').trim()
    const sid = String(sessionId || '').trim()
    if (!tid || !sid) return
    deps.invalidateChatBody?.({ kind: targetKind, targetId: tid }, sid)
  }

  async function refreshRoleSession(roleId: string, sessionId: string, onLoaded?: (chat: any) => void, options?: { activate?: boolean }) {
    return refreshTargetSession('role', roleId, sessionId, onLoaded, options)
  }

  async function refreshTargetSession(targetKind: ChatTargetKind, targetId: string, sessionId: string, onLoaded?: (chat: any) => void, options?: { activate?: boolean }) {
    const state = getState()
    const tid = String(targetId || '').trim()
    const sid = String(sessionId || '').trim()
    if (!state.data || !tid || !sid) return null
    const workspaceTarget = targetKind === 'workspace' ? splitWorkspaceTargetId(tid) : { workspaceId: '', roleId: '' }
    if (targetKind === 'workspace' && (!workspaceTarget.workspaceId || !workspaceTarget.roleId)) return null
    // 写路径之后的重取：先失效正文缓存，再读。
    // 不做这一步的话，reload 会命中写之前的正文，新消息消失、已删消息复活。
    invalidateChatBodyAfterWrite(targetKind, tid, sid)
    let box: any = null
    if (targetKind === 'group') {
      if (!state.data.chatsByGroup || typeof state.data.chatsByGroup !== 'object') state.data.chatsByGroup = {}
      if (!state.data.chatsByGroup[tid] || typeof state.data.chatsByGroup[tid] !== 'object') state.data.chatsByGroup[tid] = { activeChatId: '', chatMetas: [], chats: [] }
      box = state.data.chatsByGroup[tid]
    } else if (targetKind === 'workspace') {
      if (!state.data.chatsByWorkspace || typeof state.data.chatsByWorkspace !== 'object') state.data.chatsByWorkspace = {}
      if (!state.data.chatsByWorkspace[tid] || typeof state.data.chatsByWorkspace[tid] !== 'object') state.data.chatsByWorkspace[tid] = { activeChatId: '', chatMetas: [], chats: [] }
      box = state.data.chatsByWorkspace[tid]
    } else {
      if (!state.data.chatsByRole || typeof state.data.chatsByRole !== 'object') state.data.chatsByRole = {}
      if (!state.data.chatsByRole[tid] || typeof state.data.chatsByRole[tid] !== 'object') state.data.chatsByRole[tid] = { activeChatId: '', chatMetas: [], chats: [] }
      box = state.data.chatsByRole[tid]
    }
    const writeToken = deps.sessionWrites?.capture(targetKind, tid, sid) || null
    const chat = targetKind === 'group'
      ? typeof reloadGroupSession === 'function'
        ? await reloadGroupSession(tid, sid)
        : typeof ensureChatLoaded === 'function'
          ? await ensureChatLoaded('group', tid, sid)
          : null
      : targetKind === 'workspace'
        ? typeof reloadWorkspaceSession === 'function'
          ? await reloadWorkspaceSession(workspaceTarget.workspaceId, workspaceTarget.roleId, sid)
          : typeof ensureWorkspaceChatLoaded === 'function'
            ? await ensureWorkspaceChatLoaded(workspaceTarget.workspaceId, workspaceTarget.roleId, sid)
            : null
      : typeof reloadRoleSession === 'function'
        ? await reloadRoleSession(tid, sid)
        : typeof ensureChatLoaded === 'function'
          ? await ensureChatLoaded('role', tid, sid)
          : null
    // 读取期间会话被删除 / target 被删除：旧正文不能再触发任何落点写入。
    if (deps.sessionWrites && !deps.sessionWrites.isCurrent(writeToken)) return null
    if (chat) {
      // 用户在这段时间切到了别的会话：旧刷新的「激活」不得把选中事实抢回来；
      // 会话已被删除时也不写：activeChatId 不能指向不存在的会话。
      const currentSelection = readActiveChatSelection(box)
      const canActivate = !currentSelection || currentSelection === sid
      if (options?.activate !== false && canActivate && activeChatIdExistsInBox(box, sid)) {
        writeActiveChatSelection(box, sid)
      }
      onLoaded?.(chat)
      deps.emitScope(refreshScopes.session(targetKind, tid, sid))
      deps.emitScope(refreshScopes.chatList(targetKind, tid))
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
    const roleId = targetKind === 'workspace'
      ? String(chat?.roleId || sa.activeRole()?.id || '').trim()
      : String(sa.activeRole()?.id || '').trim()
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

  // persistSessionView 是「视图回写」的唯一入口。
  //
  // 语义：把用户选中的分支头部变成服务端事实，供多客户端 / 重启后恢复。
  // 失败不打断本地交互：本地分支状态已经生效，回写只是让它可被别处看见。
  // 工作区会话不走 scope 化视图通道，直接跳过。
  async function persistActiveView(targetKind: ChatTargetKind, targetId: string, sessionId: string, head: string, branchId: string) {
    if (targetKind === 'workspace') return
    const tid = String(targetId || '').trim()
    const sid = String(sessionId || '').trim()
    const headMid = String(head || '').trim()
    if (!tid || !sid || !headMid) return
    if (typeof deps.persistSessionView !== 'function') return
    try {
      await deps.persistSessionView(targetKind, tid, sid, headMid, String(branchId || '').trim())
    } catch (_) {
      // 视图回写失败不影响本地：下一次切换会再写一次。
    }
  }

  // activateResolvedPendingSelection 是 pending 会话落成真实会话后的唯一收口。
  //
  // 本地选择事实先同步落地（UI 必须立刻切到新会话），随后走与普通点击完全相同的
  // 偏好持久化入口，把「用户选中了它」写进服务端偏好。只改 activeChatId：
  // chatMetas / 正文 / 分支 / 运行卡 / chat.status 一律不在这里碰。
  //
  // 工作区会话没有对应的偏好命令（协议 scope 只有 role/group），保持原有行为；
  // 重复调用不会重复持久化：pending 在第一次成功迁移时已经被清空。
  async function activateResolvedPendingSelection(targetKind: ChatTargetKind, targetIdRaw: string, chatIdRaw: string, expectedPendingChatIdRaw?: string) {
    const targetId = String(targetIdRaw || '').trim()
    const chatId = String(chatIdRaw || '').trim()
    if (!targetId || !chatId) return false
    const activated = activateResolvedPendingChat(getState(), targetKind, targetId, chatId, expectedPendingChatIdRaw)
    if (!activated) return false
    if (targetKind === 'workspace') return true
    try {
      await deps.persistActiveChatSelection?.(targetKind, targetId, chatId)
    } catch (_) {
      // 本地选择已经生效；偏好命令自身会在 onError 上报失败，这里只负责不产生未处理拒绝。
    }
    return true
  }

  return {
    deps,
    sa,
    cancelledRunIds,
    startingRoleRunKeys,
    splitWorkspaceTargetId,
    invalidateChatBodyAfterWrite,
    persistActiveView,
    activateResolvedPendingSelection,
    refreshRoleSession,
    refreshTargetSession,
    activeSingleRoleTarget,
    activeTargetSessionMutationTarget,
    ensureTargetSessionMessageMutationAllowed,
  }
}
