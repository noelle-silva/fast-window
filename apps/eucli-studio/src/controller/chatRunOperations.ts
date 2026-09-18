import { collectChatMessageIds, findChatMessageById, findNewestNewLeafMessageId, activateChatBranchByMessage } from '../domain/branching'
import { normalizeChatModelOverride, normalizeModelRef } from '../domain/modelRefUtils'
import { normalizeHookPromptSelection } from '../domain/hookPrompt'
import { chatReasoningEffort } from '../domain/reasoning'
import { chatStreamEnabled } from '../domain/chatStream'
import {
  activeEbRoleRunCards,
  activeEbRunCardsForTarget,
  ebRoleRunCardIsOnMessagePath,
  findEbRoleRunCard,
  latestEbRunCardForTarget,
  markEbRoleRunCardCancelled,
  removeEbRoleRunCard,
  upsertEbRoleRunCard,
} from '../domain/activeRunCards'
import { activateResolvedPendingChat, pendingChatForTarget } from '../domain/pendingChat'
import {
  activeComposerDraftKey,
  activateComposerDraftForCurrentSession,
  clearComposerDraftByKey,
  readActiveComposerDraft,
  readComposerDraftByKey,
} from '../domain/sessionComposerDrafts'
import type { DraftFileItem } from '../domain/draftFileUtils'
import { buildGroupSpeakerPlan } from '../domain/groupSpeakerPlan'
import { workspaceRoleTargetId } from '../domain/workspaceRoleTarget'
import { cancelRoleRun, pollRunUntilTerminal, runStateFailureError, startRoleRun } from './ebRoleRun'
import type { EbRunState } from './ebRoleRun'
import type { ChatTargetKind, ExistingMessageRunOptions, RoleRunInput, SendChatOptions } from './chatOperationsShared'
import type { createChatOperationsShared } from './chatOperationsShared'

export function createChatRunOperations(
  shared: ReturnType<typeof createChatOperationsShared>,
  draftOperations: { buildRunAttachments: (draftImages: any[], draftFiles: DraftFileItem[]) => any[] },
) {
  const { deps, sa, cancelledRunIds, startingRoleRunKeys, refreshRoleSession, refreshTargetSession, activeTargetSessionMutationTarget, activeSingleRoleTarget, ensureTargetSessionMessageMutationAllowed } = shared
  const { getState, netRequest, showToast, ensureActiveChatLoaded, render, renderComposer, scrollToBottomSoon } = deps
  const { buildRunAttachments } = draftOperations

  function workspaceTargetId(workspaceIdRaw: unknown, roleIdRaw?: unknown) {
    const roleId = String(roleIdRaw || sa.activeRole()?.id || '').trim()
    return workspaceRoleTargetId(workspaceIdRaw, roleId)
  }

  async function waitForCurrentChatSettingsSave() {
    try {
      await deps.waitForChatSettingsSave?.()
      return true
    } catch (e) {
      showToast?.(String((e as any)?.message || e || '当前会话设置保存失败'), { kind: 'error' })
      return false
    }
  }

  function roleRunStartKey(input: RoleRunInput) {
    const roleId = String(input.roleId || '').trim()
    const groupId = String(input.groupId || '').trim()
    const workspaceId = String(input.workspaceId || '').trim()
    const sessionId = String(input.sessionId || '').trim()
    const parentMessageId = String(input.parentMessageId || '').trim()
    const userMessageId = String(input.userMessageId || '').trim()
    const contextMessageId = String(input.contextMessageId || '').trim()
    const message = String(input.message || '').trim()
    const reasoningEffort = String(input.reasoningEffort || '').trim()
    const hookPromptMode = String(input.hookPromptMode || '').trim()
    const hookPromptPresetId = String(input.hookPromptPresetId || '').trim()
    return [workspaceId ? `workspace:${workspaceId}` : groupId ? `group:${groupId}` : 'role', roleId, sessionId, contextMessageId ? `context:${contextMessageId}` : userMessageId ? `user:${userMessageId}` : `parent:${parentMessageId}`, message, reasoningEffort, roleRunModelOverrideKey(input.modelOverride), hookPromptMode, hookPromptPresetId].join('\n')
  }

  function roleRunModelOverrideKey(value: unknown) {
    const ref = normalizeModelRef(value)
    return ref ? JSON.stringify({ kind: ref.kind, providerId: ref.providerId, groupId: ref.groupId, modelId: ref.modelId }) : ''
  }

  function currentRoleChatModelOverride() {
    return normalizeChatModelOverride(sa.activeChatFromData())
  }

  function chatHookPromptSelection(chat: any) {
    return normalizeHookPromptSelection(chat)
  }

  function findActiveRunAtMessage(roleId: string, sessionId: string, messageId: string) {
    return findActiveRunAtMessageForTarget('role', roleId, sessionId, messageId)
  }

  function findActiveRunAtMessageForTarget(targetKind: ChatTargetKind, targetId: string, sessionId: string, messageId: string) {
    const mid = String(messageId || '').trim()
    const tid = String(targetId || '').trim()
    const sid = String(sessionId || '').trim()
    if (!mid || !tid || !sid) return null
    return activeEbRunCardsForTarget(getState(), targetKind, tid, sid).find((card) => card.inputMessageId === mid || card.anchorMessageId === mid || card.lastMessageId === mid) || null
  }

  function activeBranchMessagePath(chat: any) {
    const ids = new Set<string>()
    const headMid = activeChatHeadMid(chat)
    const messages = Array.isArray(chat?.messages) ? chat.messages : []
    if (!headMid || !messages.length) return { ids, headMid }
    const byId = new Map<string, any>()
    for (const message of messages) {
      const id = String(message?.id || '').trim()
      if (id && !byId.has(id)) byId.set(id, message)
    }
    let current = headMid
    const seen = new Set<string>()
    while (current && !seen.has(current)) {
      seen.add(current)
      const message = byId.get(current) || null
      if (!message) break
      ids.add(current)
      current = String(message?.parentMid || '').trim()
    }
    return { ids, headMid }
  }

  function activeBranchHasActiveRun(roleId: string, sessionId: string, chat: any) {
    return activeBranchHasActiveRunForTarget('role', roleId, sessionId, chat)
  }

  function activeBranchHasActiveRunForTarget(targetKind: ChatTargetKind, targetId: string, sessionId: string, chat: any) {
    const cards = activeEbRunCardsForTarget(getState(), targetKind, targetId, sessionId)
    const path = activeBranchMessagePath(chat)
    return cards.some((card) => ebRoleRunCardIsOnMessagePath(card, path.ids, path.headMid))
  }

  function ensureStableComposerParent(roleId: string, sessionId: string, chat: any, parentMid: string, explicitParent: boolean) {
    return ensureStableComposerParentForTarget('role', roleId, sessionId, chat, parentMid, explicitParent)
  }

  function ensureStableComposerParentForTarget(targetKind: ChatTargetKind, targetId: string, sessionId: string, chat: any, parentMid: string, explicitParent: boolean) {
    const mid = String(parentMid || '').trim()
    if (!chat || !mid) return true
    const parent = findChatMessageById(chat, mid)
    if (!explicitParent && parent && String((parent as any).role || '') === 'user' && findActiveRunAtMessageForTarget(targetKind, targetId, sessionId, mid)) {
      showToast?.('这个问题已有运行中的回答，请从用户消息菜单并排生成，或选择一条稳定回复后继续', { kind: 'error' })
      return false
    }
    if (!explicitParent && activeBranchHasActiveRunForTarget(targetKind, targetId, sessionId, chat)) {
      showToast?.('当前路线仍有运行中的任务，请停止或等待完成后再发送', { kind: 'error' })
      return false
    }
    return true
  }

  function dependencyMessageIdsForRunStart(chat: any, anchorMessageId: string) {
    const anchor = String(anchorMessageId || '').trim()
    if (!chat || !anchor) return []
    const messages = Array.isArray(chat?.messages) ? chat.messages : []
    const byId = new Map<string, any>()
    for (const message of messages) {
      const id = String(message?.id || '').trim()
      if (id && !byId.has(id)) byId.set(id, message)
    }
    const ids: string[] = []
    const seen = new Set<string>()
    let current = anchor
    while (current && !seen.has(current)) {
      seen.add(current)
      const message = byId.get(current) || null
      if (!message) break
      ids.push(current)
      current = String((message as any)?.parentMid || '').trim()
    }
    return ids
  }

  function syncEbRoleRunCard(run: EbRunState, fallback: { roleId: string; groupId?: string; workspaceId?: string; sessionId?: string; lastMessageId?: string; anchorMessageId?: string; dependencyMessageIds?: string[]; startedFromPending?: boolean; pendingChatId?: string }) {
    const runId = String(run?.id || '').trim()
    const state = getState()
    if (!runId) return null

    const current = findEbRoleRunCard(state, runId)
    const roleId = String(run?.roleId || fallback.roleId || current?.roleId || '').trim()
    const groupId = String((run as any)?.groupId || fallback.groupId || current?.groupId || '').trim()
    const workspaceId = String((run as any)?.workspaceId || fallback.workspaceId || current?.workspaceId || '').trim()
    const sessionId = String(run?.sessionId || fallback.sessionId || current?.sessionId || '').trim()
    const targetKind: ChatTargetKind = workspaceId ? 'workspace' : groupId ? 'group' : 'role'
    const targetId = workspaceId ? workspaceTargetId(workspaceId, roleId) : groupId || roleId
    if (fallback.startedFromPending && targetId && sessionId) activateResolvedPendingChat(state, targetKind, targetId, sessionId, fallback.pendingChatId)
    const inputMessageId = String(run?.inputMessageId || current?.inputMessageId || '').trim()
    const lastMessageId = String(run?.lastMessageId || fallback.lastMessageId || current?.lastMessageId || inputMessageId || '').trim()
    return upsertEbRoleRunCard(state, {
      runId: runId || String(current?.runId || '').trim(),
      roleId,
      groupId,
      workspaceId,
      sessionId,
      inputMessageId,
      lastMessageId,
      anchorMessageId: String(fallback.anchorMessageId || current?.anchorMessageId || inputMessageId || '').trim(),
      dependencyMessageIds: run?.dependencyMessageIds?.length ? run.dependencyMessageIds : Array.isArray(fallback.dependencyMessageIds) ? fallback.dependencyMessageIds : current?.dependencyMessageIds || [],
      status: String(run?.status || current?.status || 'running').trim(),
      stream: !!run?.stream,
      retry: run?.retry,
      cancelledByUser: !!current?.cancelledByUser,
    })
  }

  function isCurrentRoleSession(roleId: string, sessionId: string) {
    return isCurrentTargetSession('role', roleId, sessionId)
  }

  function isCurrentTargetSession(targetKind: ChatTargetKind, targetId: string, sessionId: string) {
    const state = getState()
    const tid = String(targetId || '').trim()
    const sid = String(sessionId || '').trim()
    if (!state?.data || !tid || !sid) return false
    if (sa.activeTargetKind() !== targetKind) return false
    const currentTargetId = targetKind === 'group'
      ? String(sa.activeGroup()?.id || state.draft?.activeGroupId || state.data?.ui?.activeGroupId || '').trim()
      : targetKind === 'workspace'
        ? workspaceTargetId(sa.activeWorkspace?.()?.id || state.draft?.activeWorkspaceId || state.data?.ui?.activeWorkspaceId)
        : String(state.draft?.activeRoleId || state.data?.ui?.activeRoleId || '').trim()
    if (currentTargetId !== tid) return false
    const box = targetKind === 'group'
      ? state.data.chatsByGroup && typeof state.data.chatsByGroup === 'object'
        ? state.data.chatsByGroup[tid]
        : null
      : targetKind === 'workspace'
        ? state.data.chatsByWorkspace && typeof state.data.chatsByWorkspace === 'object'
          ? state.data.chatsByWorkspace[tid]
          : null
      : state.data.chatsByRole && typeof state.data.chatsByRole === 'object'
        ? state.data.chatsByRole[tid]
        : null
    return String(box?.activeChatId || '').trim() === sid
  }

  function followRunResultBranch(chat: any, follow: { previousMessageIds: Set<string>; ancestorMessageId?: string; messageId?: string } | null | undefined) {
    if (!follow || !chat) return false
    const explicitMessageId = String(follow.messageId || '').trim()
    const targetMessageId = findNewestNewLeafMessageId(chat, follow.previousMessageIds, follow.ancestorMessageId, explicitMessageId)
    if (!targetMessageId) return false
    return activateChatBranchByMessage(chat, targetMessageId)
  }

  function activeChatHeadMid(chat: any) {
    const branching = chat && typeof chat === 'object' ? (chat as any).branching : null
    const activeBranchId = String(branching?.activeBranchId || 'main').trim() || 'main'
    const branches = Array.isArray(branching?.branches) ? branching.branches : []
    const branch = branches.find((item: any) => String(item?.id || '').trim() === activeBranchId) || null
    const headMid = String(branch?.headMid || '').trim()
    if (headMid) return headMid
    const messages = Array.isArray(chat?.messages) ? chat.messages : []
    return messages.length ? String(messages[messages.length - 1]?.id || '').trim() : ''
  }

  function targetSessionViewAnchor(targetKind: ChatTargetKind, targetId: string, sessionId: string) {
    if (!isCurrentTargetSession(targetKind, targetId, sessionId)) return null
    const chat = sa.activeChatFromData()
    const branchId = String((chat as any)?.branching?.activeBranchId || '').trim()
    return { branchId, headMid: activeChatHeadMid(chat) }
  }

  function targetSessionViewUnchanged(targetKind: ChatTargetKind, targetId: string, sessionId: string, anchor: { branchId: string; headMid: string } | null | undefined) {
    if (!anchor || !isCurrentTargetSession(targetKind, targetId, sessionId)) return false
    const chat = sa.activeChatFromData()
    const branchId = String((chat as any)?.branching?.activeBranchId || '').trim()
    return branchId === anchor.branchId && activeChatHeadMid(chat) === anchor.headMid
  }

  function targetPendingViewStillCurrent(targetKind: ChatTargetKind, targetId: string, sessionId: string, pendingChatId: string) {
    const state = getState()
    const pending = pendingChatForTarget(state, targetKind, targetId)
    if (pending) return String(pending?.id || '').trim() === String(pendingChatId || '').trim()
    const box = targetKind === 'group'
      ? state?.data?.chatsByGroup && typeof state.data.chatsByGroup === 'object'
        ? state.data.chatsByGroup[targetId]
        : null
      : targetKind === 'workspace'
        ? state?.data?.chatsByWorkspace && typeof state.data.chatsByWorkspace === 'object'
          ? state.data.chatsByWorkspace[targetId]
          : null
      : state?.data?.chatsByRole && typeof state.data.chatsByRole === 'object'
        ? state.data.chatsByRole[targetId]
        : null
    return !!sessionId && String(box?.activeChatId || '').trim() === sessionId
  }

  function roleMessageParentForSend(chat: any, explicitParentMid?: string) {
    const explicit = String(explicitParentMid || '').trim()
    if (explicit) return explicit
    const state = getState()
    const draft = state.branchDraft && typeof state.branchDraft === 'object' ? state.branchDraft : null
    const role = sa.activeRole()
    const chatId = String(chat?.id || '').trim()
    if (draft && String(draft?.roleId || '') === String(role?.id || '') && String(draft?.chatId || '') === chatId) {
      const forkFromMid = String(draft?.forkFromMid || '').trim()
      if (forkFromMid) return forkFromMid
    }
    return activeChatHeadMid(chat)
  }

  function stableExplicitParentForSend(roleId: string, sessionId: string, chat: any, explicitParentMid: string) {
    const mid = String(explicitParentMid || '').trim()
    if (!mid || !chat) return mid
    const parent = findChatMessageById(chat, mid)
    if (!parent || String((parent as any).role || '') !== 'user') return mid
    const hasRunningReply = !!findActiveRunAtMessage(roleId, sessionId, mid)
    if (!hasRunningReply) return mid
    return String((parent as any).parentMid || '').trim() || mid
  }

  async function runRoleMessageViaEb(
    input: RoleRunInput,
    onAccepted?: (run: EbRunState) => void,
    follow?: { previousMessageIds: Set<string>; ancestorMessageId?: string },
    onState?: (run: EbRunState) => void,
  ) {
    if (typeof netRequest !== 'function') throw new Error('e-b 请求通道不可用')
    const startKey = roleRunStartKey(input)
    if (startingRoleRunKeys.has(startKey)) throw new Error('该位置已有启动中的请求，请稍候')
    const stateBeforeRun = getState()
      const groupId = String(input.groupId || '').trim()
      const workspaceId = String(input.workspaceId || '').trim()
      const targetKind: ChatTargetKind = workspaceId ? 'workspace' : groupId ? 'group' : 'role'
      const targetId = workspaceId ? workspaceTargetId(workspaceId, input.roleId) : groupId || String(input.roleId || '').trim()
    const pendingAtStart = !String(input.sessionId || '').trim() ? pendingChatForTarget(stateBeforeRun, targetKind, targetId) : null
    const startedFromPending = !!pendingAtStart
    const startedFromPendingChatId = String(pendingAtStart?.id || '').trim()
    let followPendingOnce = startedFromPending
    let followViewAnchor = targetSessionViewAnchor(targetKind, targetId, String(input.sessionId || '').trim())
    startingRoleRunKeys.add(startKey)
    let state: EbRunState
    try {
      state = await startRoleRun(netRequest, input)
    } finally {
      startingRoleRunKeys.delete(startKey)
    }
    if (!state.id) throw new Error('e-b 未返回 run id')
    onAccepted?.(state)
    let sessionId = String(state.sessionId || input.sessionId || '').trim()
    let followMessageId = String(state.lastMessageId || '').trim()
    const runAnchorMessageId = String(follow?.ancestorMessageId || input.contextMessageId || input.userMessageId || input.parentMessageId || '').trim()
    const dependencyMessageIds = dependencyMessageIdsForRunStart(sa.activeChatFromData(), runAnchorMessageId)
    syncEbRoleRunCard(state, { roleId: input.roleId, groupId, workspaceId, sessionId, lastMessageId: followMessageId, anchorMessageId: runAnchorMessageId, dependencyMessageIds, startedFromPending, pendingChatId: startedFromPendingChatId })
    onState?.(state)
    let runSessionLoadedOnce = false

    const refreshRunSession = async () => {
      if (!sessionId) return
      const shouldFollowNow = (followPendingOnce && targetPendingViewStillCurrent(targetKind, targetId, sessionId, startedFromPendingChatId)) || targetSessionViewUnchanged(targetKind, targetId, sessionId, followViewAnchor)
      let followed = false
      await refreshTargetSession(targetKind, targetId, sessionId, (chat) => {
        if (shouldFollowNow) followed = followRunResultBranch(chat, follow ? { ...follow, messageId: followMessageId } : null)
      }, { activate: shouldFollowNow })
      if (followed) followViewAnchor = targetSessionViewAnchor(targetKind, targetId, sessionId)
      followPendingOnce = false
      runSessionLoadedOnce = true
    }

    const refreshTerminalRunSession = async () => {
      if (!sessionId) return
      const shouldFollowNow = targetSessionViewUnchanged(targetKind, targetId, sessionId, followViewAnchor)
      let followed = false
      await refreshTargetSession(targetKind, targetId, sessionId, (chat) => {
        if (shouldFollowNow) followed = followRunResultBranch(chat, follow ? { ...follow, messageId: followMessageId } : null)
      }, { activate: shouldFollowNow })
      if (followed) followViewAnchor = targetSessionViewAnchor(targetKind, targetId, sessionId)
      runSessionLoadedOnce = true
    }

    if (sessionId) await refreshRunSession()

    state = await pollRunUntilTerminal(netRequest, state, async (nextState) => {
      state = nextState
      followMessageId = String(state.lastMessageId || followMessageId || '').trim()
      syncEbRoleRunCard(state, { roleId: input.roleId, groupId, workspaceId, sessionId, lastMessageId: followMessageId, anchorMessageId: runAnchorMessageId, dependencyMessageIds, startedFromPending, pendingChatId: startedFromPendingChatId })
      onState?.(state)
      const nextSessionId = String(state.sessionId || sessionId || '').trim()
      if (nextSessionId) {
        sessionId = nextSessionId
        if (!runSessionLoadedOnce && (startedFromPending || !input.sessionId)) await refreshRunSession()
      }
    })

    followMessageId = String(state.lastMessageId || followMessageId || '').trim()
    await refreshTerminalRunSession()
    if (state.status === 'failed' || state.status === 'cancelled') throw runStateFailureError(state)
    if (!sessionId) throw new Error('e-b 未返回会话ID')
    return sessionId
  }

  function finishRoleRun(runId: string) {
    const id = String(runId || '').trim()
    if (!id) return null
    const state = getState()
    const removed = removeEbRoleRunCard(state, id)
    cancelledRunIds.delete(id)
    return removed
  }

  function latestTargetRunCard(targetKind: ChatTargetKind, targetId: string, sessionId: string) {
    const tid = String(targetId || '').trim()
    const sid = String(sessionId || '').trim()
    if (!tid) return null
    if (sid) return latestEbRunCardForTarget(getState(), targetKind, tid, sid)
    const cards = activeEbRoleRunCards(getState()).filter((card) => card.sessionId && card.sessionId.trim() && ((targetKind === 'group' && card.groupId === tid) || (targetKind === 'workspace' && card.workspaceId === tid) || (targetKind === 'role' && !card.groupId && !card.workspaceId && card.roleId === tid)))
    return cards.length ? cards[cards.length - 1] : null
  }

  async function runRoleFromUserMessage(input: { roleId: string; workspaceId?: string; sessionId: string; userMessageId: string }, operationText: string, opts?: ExistingMessageRunOptions) {
    const state = getState()
    const userMessageId = String(input.userMessageId || '').trim()
    if (!userMessageId) return false
    if (!(await waitForCurrentChatSettingsSave())) return false
    const chatBeforeRun = sa.activeChatFromData()
    const previousMessageIds = collectChatMessageIds(chatBeforeRun)
    let acceptedRunId = ''
    try {
      renderComposer()
      const reasoningEffort = chatReasoningEffort(sa.activeChatFromData())
      const modelOverride = currentRoleChatModelOverride()
      const hookSelection = chatHookPromptSelection(sa.activeChatFromData())
      await runRoleMessageViaEb({ roleId: input.roleId, workspaceId: input.workspaceId, sessionId: input.sessionId, userMessageId, reasoningEffort, modelOverride, hookPromptMode: hookSelection.mode, hookPromptPresetId: hookSelection.presetId }, (run) => {
        acceptedRunId = String(run?.id || '').trim()
        syncEbRoleRunCard(run, { roleId: input.roleId, workspaceId: input.workspaceId, sessionId: input.sessionId, anchorMessageId: userMessageId })
        renderComposer()
      }, { previousMessageIds, ancestorMessageId: userMessageId }, (run) => opts?.onRunState?.(run))
      return true
    } catch (e) {
      const msg = String((e as any)?.message || e || `${operationText}失败`)
      if (acceptedRunId && cancelledRunIds.has(acceptedRunId)) showToast?.('已停止', { kind: 'success' })
      else showToast?.(msg, { kind: 'error' })
      return false
    } finally {
      if (acceptedRunId) finishRoleRun(acceptedRunId)
      render()
      scrollToBottomSoon()
    }
  }

  async function runRoleFromContextMessage(input: { roleId: string; workspaceId?: string; sessionId: string; contextMessageId: string }, operationText: string, opts?: ExistingMessageRunOptions) {
    const state = getState()
    const contextMessageId = String(input.contextMessageId || '').trim()
    if (!contextMessageId) return false
    if (!(await waitForCurrentChatSettingsSave())) return false
    const chatBeforeRun = sa.activeChatFromData()
    const previousMessageIds = collectChatMessageIds(chatBeforeRun)
    let acceptedRunId = ''
    try {
      renderComposer()
      const reasoningEffort = chatReasoningEffort(sa.activeChatFromData())
      const modelOverride = currentRoleChatModelOverride()
      const hookSelection = chatHookPromptSelection(sa.activeChatFromData())
      await runRoleMessageViaEb({ roleId: input.roleId, workspaceId: input.workspaceId, sessionId: input.sessionId, contextMessageId, reasoningEffort, modelOverride, hookPromptMode: hookSelection.mode, hookPromptPresetId: hookSelection.presetId }, (run) => {
        acceptedRunId = String(run?.id || '').trim()
        syncEbRoleRunCard(run, { roleId: input.roleId, workspaceId: input.workspaceId, sessionId: input.sessionId, anchorMessageId: contextMessageId })
        renderComposer()
      }, { previousMessageIds, ancestorMessageId: contextMessageId }, (run) => opts?.onRunState?.(run))
      return true
    } catch (e) {
      const msg = String((e as any)?.message || e || `${operationText}失败`)
      if (acceptedRunId && cancelledRunIds.has(acceptedRunId)) showToast?.('已停止', { kind: 'success' })
      else showToast?.(msg, { kind: 'error' })
      return false
    } finally {
      if (acceptedRunId) finishRoleRun(acceptedRunId)
      render()
      scrollToBottomSoon()
    }
  }

  async function runGroupSpeakerSequence(input: { groupId: string; sessionId: string; roleIds: string[]; operationText: string; contextMessageId?: string; message?: string; attachments?: any[]; parentMessageId?: string; clearComposerDraftKey?: string; hookPromptMode?: string; hookPromptPresetId?: string; stream?: boolean }, opts?: ExistingMessageRunOptions) {
    const state = getState()
    const groupId = String(input.groupId || '').trim()
    let sessionId = String(input.sessionId || '').trim()
    let contextMessageId = String(input.contextMessageId || '').trim()
    const roleIds = Array.isArray(input.roleIds) ? input.roleIds.map((roleId) => String(roleId || '').trim()).filter(Boolean) : []
    if (!groupId || !roleIds.length) return false
    if (!(await waitForCurrentChatSettingsSave())) return false

    let clearDraftOnce = !!String(input.clearComposerDraftKey || '').trim()
    try {
      renderComposer()
      for (let index = 0; index < roleIds.length; index++) {
        const roleId = roleIds[index]
        const role = sa.getRoleById(roleId)
        if (!role) throw new Error('群组成员角色不存在')
        sa.ensureRoleDefaults(role)

        const isFirstMessageRun = index === 0 && (!!String(input.message || '').trim() || (Array.isArray(input.attachments) && input.attachments.length > 0))
        if (!isFirstMessageRun && !contextMessageId) throw new Error('未找到可用于继续发言的上文')

        const chatBeforeRun = sa.activeChatFromData()
        const previousMessageIds = collectChatMessageIds(chatBeforeRun)
        const anchorMessageId = isFirstMessageRun ? String(input.parentMessageId || '').trim() : contextMessageId
        const runInput: RoleRunInput = {
          roleId,
          groupId,
          sessionId,
          hookPromptMode: String(input.hookPromptMode || '').trim(),
          hookPromptPresetId: String(input.hookPromptPresetId || '').trim(),
          stream: index === 0 && !sessionId && typeof input.stream === 'boolean' ? input.stream : undefined,
        }
        if (isFirstMessageRun) {
          runInput.message = String(input.message || '').trim()
          runInput.attachments = Array.isArray(input.attachments) ? input.attachments : []
          if (anchorMessageId) runInput.parentMessageId = anchorMessageId
        } else {
          runInput.contextMessageId = contextMessageId
        }

        let acceptedRunId = ''
        try {
          const nextSessionId = await runRoleMessageViaEb(runInput, (run) => {
            acceptedRunId = String(run?.id || '').trim()
            syncEbRoleRunCard(run, { roleId, groupId, sessionId, anchorMessageId })
            if (clearDraftOnce) {
              clearComposerDraftByKey(state, input.clearComposerDraftKey)
              clearDraftOnce = false
            }
            renderComposer()
          }, { previousMessageIds, ancestorMessageId: anchorMessageId }, (run) => opts?.onRunState?.(run))
          sessionId = String(nextSessionId || sessionId || '').trim()
        } catch (e) {
          const msg = String((e as any)?.message || e || `${input.operationText || '群组发言'}失败`)
          if (acceptedRunId && cancelledRunIds.has(acceptedRunId)) showToast?.('已停止', { kind: 'success' })
          else showToast?.(msg, { kind: 'error' })
          return false
        } finally {
          if (acceptedRunId) finishRoleRun(acceptedRunId)
        }

        const activeChat = sa.activeChatFromData()
        contextMessageId = activeChatHeadMid(activeChat) || contextMessageId
      }
      return true
    } finally {
      render()
      scrollToBottomSoon()
    }
  }

  async function runGroupSingleSpeaker(input: { groupId: string; sessionId: string; roleId: string; contextMessageId: string; operationText: string }, opts?: ExistingMessageRunOptions) {
    return runGroupSpeakerSequence({ groupId: input.groupId, sessionId: input.sessionId, roleIds: [input.roleId], contextMessageId: input.contextMessageId, operationText: input.operationText }, opts)
  }

  async function sendChat(opts?: SendChatOptions) {
    const state = getState()
    if (state.loading || !state.data) return

    if (sa.activeTargetKind() === 'group') {
      await sendGroupChat(opts)
      return
    }

    if (!(await waitForCurrentChatSettingsSave())) return

    const role = sa.activeRole()
    if (!role) return
    sa.ensureRoleDefaults(role)

    activateComposerDraftForCurrentSession(state)
    const draftKey = activeComposerDraftKey(state)
    const composerDraft = draftKey ? readComposerDraftByKey(state, draftKey) : readActiveComposerDraft(state)
    const input = String(composerDraft.input || '').trim()
    const draftImages = Array.isArray(composerDraft.images) ? composerDraft.images : []
    const draftFiles: DraftFileItem[] = Array.isArray(composerDraft.files) ? (composerDraft.files as any[]) : []
    const hasFiles = draftFiles.length > 0
    if (!input && !draftImages.length && !hasFiles) return showToast?.('输入不能为空', { kind: 'error' })
    let attachments: any[] = []
    try {
      attachments = buildRunAttachments(draftImages, draftFiles)
    } catch (e) {
      return showToast?.(String((e as any)?.message || e || '附件无效'), { kind: 'error' })
    }

    const rid = String(role.id || '')
    const workspaceId = sa.activeTargetKind() === 'workspace' ? String(sa.activeWorkspace?.()?.id || '').trim() : ''
    const pendingKind: ChatTargetKind = workspaceId ? 'workspace' : 'role'
    const pendingTargetId = workspaceId ? workspaceTargetId(workspaceId, rid) : rid
    const pendingChat = pendingChatForTarget(state, pendingKind, pendingTargetId)
    const loadedChat = pendingChat ? null : await ensureActiveChatLoaded?.().catch(() => null)
    const currentChat = pendingChat ? null : loadedChat || sa.activeChatFromData()
    const modelOverride = normalizeChatModelOverride(pendingChat || currentChat)
    const hookSelection = chatHookPromptSelection(pendingChat || currentChat)
    const stream = pendingChat ? chatStreamEnabled(pendingChat) : undefined

    let chat = pendingChat ? null : currentChat
    let sessionId = String(chat?.id || '').trim()
    if (sessionId) sessionId = String(chat?.id || sessionId).trim()
    const forkFromMid = String(opts?.forkFromMid || '').trim()
    const branchDraft = state.branchDraft && typeof state.branchDraft === 'object' ? state.branchDraft : null
    const branchDraftParentId =
      branchDraft && String(branchDraft?.roleId || '') === rid && String(branchDraft?.chatId || '') === sessionId
        ? String(branchDraft?.forkFromMid || '').trim()
        : ''
    const explicitParentMid = forkFromMid || branchDraftParentId
    const parentMessageId = sessionId ? stableExplicitParentForSend(rid, sessionId, chat, explicitParentMid) || roleMessageParentForSend(chat) : ''
    const hasExplicitParent = !!forkFromMid || !!branchDraftParentId
    if (sessionId && !ensureStableComposerParent(rid, sessionId, chat, parentMessageId, hasExplicitParent)) return
    const previousMessageIds = collectChatMessageIds(chat)
    let acceptedRunId = ''
    try {
      renderComposer()
      const reasoningEffort = chatReasoningEffort(pendingChat || currentChat)
      await runRoleMessageViaEb({ roleId: rid, workspaceId, sessionId, message: input, attachments, parentMessageId, reasoningEffort, modelOverride, hookPromptMode: hookSelection.mode, hookPromptPresetId: hookSelection.presetId, stream }, (run) => {
        acceptedRunId = String(run?.id || '').trim()
        syncEbRoleRunCard(run, { roleId: rid, workspaceId, sessionId, anchorMessageId: parentMessageId })
        clearComposerDraftByKey(state, draftKey)
        state.branchDraft = null
        renderComposer()
        render()
      }, { previousMessageIds, ancestorMessageId: parentMessageId }, (run) => opts?.onRunState?.(run))
    } catch (e) {
      const msg = String((e as any)?.message || e || '请求失败')
      if (acceptedRunId && cancelledRunIds.has(acceptedRunId)) showToast?.('已停止', { kind: 'success' })
      else showToast?.(msg, { kind: 'error' })
    } finally {
      if (acceptedRunId) finishRoleRun(acceptedRunId)
      render()
    }
  }

  async function sendGroupChat(opts?: SendChatOptions) {
    const state = getState()
    if (state.loading || !state.data) return

    const group = sa.activeGroup()
    if (!group) return

    activateComposerDraftForCurrentSession(state)
    const draftKey = activeComposerDraftKey(state)
    const composerDraft = draftKey ? readComposerDraftByKey(state, draftKey) : readActiveComposerDraft(state)
    const input = String(composerDraft.input || '').trim()
    const draftImages = Array.isArray(composerDraft.images) ? composerDraft.images : []
    const draftFiles: DraftFileItem[] = Array.isArray(composerDraft.files) ? (composerDraft.files as any[]) : []
    const hasFiles = draftFiles.length > 0
    if (!input && !draftImages.length && !hasFiles) return showToast?.('输入不能为空', { kind: 'error' })

    let attachments: any[] = []
    try {
      attachments = buildRunAttachments(draftImages, draftFiles)
    } catch (e) {
      return showToast?.(String((e as any)?.message || e || '附件无效'), { kind: 'error' })
    }

    const groupId = String(group.id || '').trim()
    const currentChat = (await ensureActiveChatLoaded?.().catch(() => null)) || sa.activeChatFromData()
    const pendingChat = pendingChatForTarget(state, 'group', groupId)
    const sessionChat = pendingChat ? null : currentChat
    const hookSelection = chatHookPromptSelection(pendingChat || sessionChat)
    const stream = pendingChat ? chatStreamEnabled(pendingChat) : undefined
    const speakerPlan = buildGroupSpeakerPlan(group, (roleId) => !!sa.getRoleById(roleId))
    if (speakerPlan.error) return showToast?.(speakerPlan.error, { kind: 'error' })

    const currentSessionId = String(sessionChat?.id || '').trim()
    const parentMessageId = currentSessionId ? roleMessageParentForSend(sessionChat) : ''
    if (currentSessionId && !ensureStableComposerParentForTarget('group', groupId, currentSessionId, sessionChat, parentMessageId, false)) return

    return runGroupSpeakerSequence({
      groupId,
      sessionId: currentSessionId,
      roleIds: speakerPlan.roleIds,
      message: input,
      attachments,
      parentMessageId,
      clearComposerDraftKey: draftKey,
      hookPromptMode: hookSelection.mode,
      hookPromptPresetId: hookSelection.presetId,
      stream,
      operationText: '群组发送',
    }, opts)
  }

  async function stopSending(runIdRaw?: any) {
    const state = getState()
    if (state.loading) return

    const explicitRunId = String(runIdRaw || '').trim()
    const targetKind = sa.activeTargetKind()
    const targetId = targetKind === 'group' ? String(sa.activeGroup()?.id || '').trim() : targetKind === 'workspace' ? workspaceTargetId(sa.activeWorkspace?.()?.id) : String(sa.activeRole()?.id || '').trim()
    const sessionId = String(sa.activeChatFromData()?.id || '').trim()
    const activeRun = explicitRunId
      ? findEbRoleRunCard(state, explicitRunId)
      : latestTargetRunCard(targetKind, targetId, sessionId) || activeEbRoleRunCards(state).slice(-1)[0] || null
    if (activeRun) {
      const runId = String(activeRun.runId || '').trim()
      if (!runId) return showToast?.('当前运行尚未拿到 e-b run id，请稍候再试', { kind: 'error' })
      if (typeof netRequest !== 'function') return showToast?.('e-b 请求通道不可用', { kind: 'error' })
      try {
        cancelledRunIds.add(runId)
        if (activeRun) markEbRoleRunCardCancelled(state, runId)
        await cancelRoleRun(netRequest, runId)
        showToast?.('已请求停止', { kind: 'success' })
        const roleId = String(activeRun?.roleId || sa.activeRole()?.id || '').trim()
        const groupId = String((activeRun as any)?.groupId || sa.activeGroup()?.id || '').trim()
        const workspaceId = String((activeRun as any)?.workspaceId || sa.activeWorkspace?.()?.id || '').trim()
        const nextSessionId = String(activeRun?.sessionId || sa.activeChatFromData()?.id || '').trim()
        if (groupId && nextSessionId) refreshTargetSession('group', groupId, nextSessionId, undefined, { activate: false }).catch(() => {})
        else if (workspaceId && nextSessionId) refreshTargetSession('workspace', workspaceTargetId(workspaceId, roleId), nextSessionId, undefined, { activate: false }).catch(() => {})
        else if (roleId && nextSessionId) refreshRoleSession(roleId, nextSessionId, undefined, { activate: false }).catch(() => {})
        renderComposer()
      } catch (e) {
        showToast?.(String((e as any)?.message || e || '停止失败'), { kind: 'error' })
      }
      return
    }
    showToast?.('当前没有可停止的 e-b 真实运行', { kind: 'error' })
  }

  async function regenerateAssistantMessage(assistantMid: any, opts?: ExistingMessageRunOptions) {
    const state = getState()
    if (state.loading || !state.data) return

    if (sa.activeTargetKind() === 'group') {
      await regenerateGroupAssistantMessage(String(assistantMid || ''), opts)
      return
    }
    const target = await activeSingleRoleTarget()
    const mid = String(assistantMid || '').trim()
    if (!target || !mid) return false
    const assistant = findChatMessageById(target.chat, mid)
    if (!assistant || String((assistant as any).role || '') !== 'assistant') return showToast?.('只能重新生成 AI 消息', { kind: 'error' })
    if (!ensureTargetSessionMessageMutationAllowed(target, mid, 'edit')) return false
    const contextMessageId = String((assistant as any).parentMid || '').trim()
    if (!contextMessageId) return showToast?.('未找到可用于重新回复的上文', { kind: 'error' })
    if (!findChatMessageById(target.chat, contextMessageId)) return showToast?.('未找到可用于重新回复的上文', { kind: 'error' })
    return runRoleFromContextMessage({ roleId: target.roleId, workspaceId: (target as any).workspaceId, sessionId: target.sessionId, contextMessageId }, '重新回复', opts)
  }

  async function regenerateGroupAssistantMessage(assistantMid: string, opts?: ExistingMessageRunOptions) {
    const state = getState()
    if (state.loading || !state.data) return

    const target = await activeTargetSessionMutationTarget()
    const mid = String(assistantMid || '').trim()
    if (!target || !mid) return false
    const assistant = findChatMessageById(target.chat, mid)
    if (!assistant || String((assistant as any).role || '') !== 'assistant') return showToast?.('只能重新生成 AI 消息', { kind: 'error' })
    const speakerRoleId = String((assistant as any).speakerRoleId || '').trim()
    if (!speakerRoleId) return showToast?.('群组消息缺少发言人标记', { kind: 'error' })
    if (!ensureTargetSessionMessageMutationAllowed(target, mid, 'edit')) return false
    const contextMessageId = String((assistant as any).parentMid || '').trim()
    if (!contextMessageId) return showToast?.('未找到可用于重新回复的上文', { kind: 'error' })
    return runGroupSingleSpeaker({
      groupId: target.groupId,
      sessionId: target.sessionId,
      roleId: speakerRoleId,
      contextMessageId,
      operationText: '重新回复',
    }, opts)
  }

  async function replyFromUserMessage(userMid: any, opts?: ExistingMessageRunOptions) {
    const state = getState()
    if (state.loading || !state.data) return

    if (sa.activeTargetKind() === 'group') {
      await replyFromUserMessageInGroup(String(userMid || ''), opts)
      return
    }
    const target = await activeSingleRoleTarget()
    const userMessageId = String(userMid || '').trim()
    if (!target || !userMessageId) return false
    const userMessage = findChatMessageById(target.chat, userMessageId)
    if (!userMessage || String((userMessage as any).role || '') !== 'user') return showToast?.('只能从用户消息继续回复', { kind: 'error' })
    return runRoleFromUserMessage({ roleId: target.roleId, workspaceId: (target as any).workspaceId, sessionId: target.sessionId, userMessageId }, '继续回复', opts)
  }

  async function replyFromUserMessageInGroup(userMid: string, opts?: ExistingMessageRunOptions) {
    const state = getState()
    if (state.loading || !state.data) return

    const target = await activeTargetSessionMutationTarget()
    const userMessageId = String(userMid || '').trim()
    if (!target || !userMessageId) return false
    const userMessage = findChatMessageById(target.chat, userMessageId)
    if (!userMessage || String((userMessage as any).role || '') !== 'user') return showToast?.('只能从用户消息继续回复', { kind: 'error' })
    const speakerPlan = buildGroupSpeakerPlan(sa.activeGroup(), (roleId) => !!sa.getRoleById(roleId))
    if (speakerPlan.error) return showToast?.(speakerPlan.error, { kind: 'error' })
    return runGroupSpeakerSequence({
      groupId: target.groupId,
      sessionId: target.sessionId,
      roleIds: speakerPlan.roleIds,
      contextMessageId: userMessageId,
      operationText: '继续回复',
    }, opts)
  }

  return {
    sendChat,
    sendGroupChat,
    stopSending,
    regenerateAssistantMessage,
    regenerateGroupAssistantMessage,
    replyFromUserMessage,
    replyFromUserMessageInGroup,
  }
}
