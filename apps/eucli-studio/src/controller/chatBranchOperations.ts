import { now } from '../core/utils'
import { CHAT_DEFAULT_BRANCH_ID } from '../domain/constants'
import { activeBranchHeadMidOrLast } from '../domain/branching'
import {
  normalizeBranchId,
  findChatMessageById,
  findPrevAssistantMidForAssistant,
  activateChatBranch,
  setChatActiveBranchId,
} from '../domain/branching'
import type { createChatOperationsShared } from './chatOperationsShared'
import { refreshScopes } from '../domain/uiRefreshScope'

export function createChatBranchOperations(shared: ReturnType<typeof createChatOperationsShared>) {
  const { deps, sa, activeSingleRoleTarget, ensureTargetSessionMessageMutationAllowed, persistActiveView } = shared
  const { getState, showToast, ensureActiveChatLoaded, emitScope, scrollToBottomSoon } = deps

  function notifyActiveSession(chat: any) {
    const targetId = String(sa.activeRole()?.id || '').trim()
    const chatId = String(chat?.id || '').trim()
    if (!targetId || !chatId) return
    emitScope(refreshScopes.session('role', targetId, chatId))
  }

  // 视图回写：本地分支状态已改，同时把它变成服务端事实。
  // head 用「活动分支头部消息」表达（比 branchId 可靠，见 design-4 决策 3）。
  function persistView(targetKind: 'role' | 'group', targetId: string, chat: any) {
    const branchId = String(chat?.branching?.activeBranchId || '').trim()
    const head = activeBranchHeadMidOrLast(chat)
    void persistActiveView(targetKind, targetId, String(chat?.id || ''), head, branchId)
  }

  async function createParallelBranchFromAssistantMessage(assistantMid: any) {
    const state = getState()
    if (state.loading || !state.data) return

    await ensureActiveChatLoaded?.()

    const targetMeta = await activeSingleRoleTarget()
    const role = sa.activeRole()
    const chat = sa.activeChatFromData()
    if (!targetMeta || !role || !chat) return
    sa.ensureRoleDefaults(role)

    const mid = String(assistantMid || '').trim()
    if (!mid) return

    const msgs = Array.isArray(chat.messages) ? chat.messages : []
    const target = msgs.find((m: any) => String(m?.id || '') === mid) || null
    if (!target || target.role !== 'assistant') return showToast?.('只能从 AI 消息新建分支', { kind: 'error' })
    if (!ensureTargetSessionMessageMutationAllowed(targetMeta, mid, 'edit')) return false

    const userMid0 = String((target as any)?.parentMid || '').trim()
    const userMsg = userMid0 ? msgs.find((m: any) => String(m?.id || '') === userMid0) || null : null
    if (!userMsg || userMsg.role !== 'user') return showToast?.('未找到对应的用户消息', { kind: 'error' })

    // 上一轮助手只由后台父子拓扑回溯；不再按数组顺序补造锚点。
    const prevAiMid = findPrevAssistantMidForAssistant(chat, mid)
    if (!prevAiMid) return showToast?.('未找到上一条 AI 消息，无法新建分支', { kind: 'error' })

    state.branchDraft = {
      roleId: String(role.id || ''),
      chatId: String(chat.id || ''),
      forkFromMid: prevAiMid,
      sourceAssistantMid: mid,
      createdAt: now(),
    }
    notifyActiveSession(chat)
    scrollToBottomSoon()
  }

  async function switchBranchByAssistantSibling(assistantMid: any, delta: any) {
    const state = getState()
    if (state.loading || !state.data) return

    await ensureActiveChatLoaded?.()

    const chat = sa.activeChatFromData()
    if (!chat) return

    const mid = String(assistantMid || '').trim()
    if (!mid) return

    const d = Math.sign(Number(delta || 0))
    if (!d) return

    const target = findChatMessageById(chat, mid)
    if (!target || String((target as any).role || '') !== 'assistant') return
    const prevAiMid = findPrevAssistantMidForAssistant(chat, mid)
    if (!prevAiMid) return

    const msgs = Array.isArray((chat as any)?.messages) ? (chat as any).messages : []

    const sibs = msgs.filter((m: any) => {
      if (!m || m.role !== 'assistant') return false
      return findPrevAssistantMidForAssistant(chat, String(m?.id || '')) === prevAiMid
    })

    sibs.sort((a: any, b: any) => {
      const da = Number(a?.createdAt || 0)
      const db = Number(b?.createdAt || 0)
      if (da !== db) return da - db
      return String(a?.id || '').localeCompare(String(b?.id || ''))
    })

    if (sibs.length < 2) return

    const i0 = sibs.findIndex((m: any) => String(m?.id || '') === mid)
    if (i0 < 0) return

    const len = sibs.length
    const i = (i0 + d + len) % len
    const picked = sibs[i]
    const pickedMid = String(picked?.id || '').trim()
    const pickedBranchId = normalizeBranchId((picked as any)?.branchId || CHAT_DEFAULT_BRANCH_ID)
    if (!pickedMid || !pickedBranchId) return

    activateChatBranch(chat, pickedBranchId, { headIfEmptyMid: pickedMid })

    persistView('role', String(sa.activeRole()?.id || ''), chat)
    const draft0 = state.branchDraft && typeof state.branchDraft === 'object' ? (state.branchDraft as any) : null
    if (draft0 && String(draft0?.roleId || '') === String(sa.activeRole()?.id || '') && String(draft0?.chatId || '') === String(chat.id || '')) {
      state.branchDraft = null
    }
    notifyActiveSession(chat)
    scrollToBottomSoon()
  }

  async function setActiveBranch(branchId: any) {
    const state = getState()
    if (state.loading || !state.data) return

    await ensureActiveChatLoaded?.()

    const chat = sa.activeChatFromData()
    if (!chat) return

    const bid = normalizeBranchId(branchId || CHAT_DEFAULT_BRANCH_ID)
    setChatActiveBranchId(chat, bid)

    const draft0 = state.branchDraft && typeof state.branchDraft === 'object' ? (state.branchDraft as any) : null
    if (draft0 && String(draft0?.roleId || '') === String(sa.activeRole()?.id || '') && String(draft0?.chatId || '') === String(chat.id || '')) {
      state.branchDraft = null
    }

    persistView('role', String(sa.activeRole()?.id || ''), chat)
    notifyActiveSession(chat)
    scrollToBottomSoon()
  }

  return {
    createParallelBranchFromAssistantMessage,
    switchBranchByAssistantSibling,
    setActiveBranch,
  }
}
