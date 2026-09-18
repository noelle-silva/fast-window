import * as React from 'react'
import { filterEbRoleRunCardsOnMessagePath } from '../../domain/activeRunCards'
import { ASSISTANT_RUNNING_CONTENT, isAssistantGenerating } from '../../domain/assistantRunState'
import { activeRunCardForAssistantMessage, isStaleAssistantPlaceholder, messageVisibleText } from '../../domain/chatMessageDisplay'
import { chatMessageMaterialKind } from '../../domain/message'
import { formatTokenEstimate, formatTokenEstimateShort, sumMessageTokenEstimate } from '../../domain/messageTokenUsage'

type TargetKind = 'role' | 'group' | 'workspace'

export function useChatMessageView(deps: {
  renderChat: any
  renderChatId: string
  chatAllMessagesRaw: any[]
  prevAiMidByAssistantId: Map<string, string>
  activeBranchIdUi: string
  activeSendPathAnchorMid: string
  activeSendPathFollowMid: string
  activeSessionRunCards: any[]
  activeSessionRunCardsKey: string
  activeChatRunCards: any[]
  activeChat: any
  activeTargetKind: TargetKind
  treeSelectedMid: string
  branchDraft: any
  branchDraftKey: string
}) {
  const {
    renderChat,
    renderChatId,
    chatAllMessagesRaw,
    prevAiMidByAssistantId,
    activeBranchIdUi,
    activeSendPathAnchorMid,
    activeSendPathFollowMid,
    activeSessionRunCards,
    activeSessionRunCardsKey,
    activeChatRunCards,
    activeChat,
    activeTargetKind,
    treeSelectedMid,
    branchDraft,
    branchDraftKey,
  } = deps

  const allMessages: any[] = React.useMemo(() => {
    const chat: any = renderChat
    const msgs = chatAllMessagesRaw
    if (!chat || !Array.isArray(msgs) || msgs.length === 0) return []

    const branching = chat?.branching
    const activeBranchId = String(branching?.activeBranchId || 'main').trim() || 'main'
    const branches = Array.isArray(branching?.branches) ? branching.branches : []
    const b = branches.find((x: any) => String(x?.id || '') === activeBranchId) || null

    const activeHeadMid = String(b?.headMid || '').trim()
    let headMid = activeHeadMid
    if (branchDraft) headMid = String(branchDraft?.forkFromMid || '').trim() || headMid
    if (!branchDraft && treeSelectedMid) headMid = String(treeSelectedMid || '').trim() || headMid
    else if (!branchDraft && activeSendPathAnchorMid) headMid = activeSendPathFollowMid || activeSendPathAnchorMid
    if (!headMid) headMid = String(msgs[msgs.length - 1]?.id || '').trim()
    if (!headMid) return msgs

    const byId = new Map<string, any>()
    for (const m of msgs) {
      const id = String(m?.id || '').trim()
      if (!id || byId.has(id)) continue
      byId.set(id, m)
    }

    const out: any[] = []
    const seen = new Set<string>()
    let cur = headMid
    while (cur && !seen.has(cur)) {
      seen.add(cur)
      const m = byId.get(cur) || null
      if (!m) break
      out.push(m)
      cur = String((m as any)?.parentMid || '').trim()
    }

    out.reverse()
    return out.length ? out : msgs
  }, [renderChatId, Number((renderChat as any)?.updatedAt || 0), activeBranchIdUi, branchDraftKey, treeSelectedMid, activeSendPathAnchorMid, activeSendPathFollowMid, chatAllMessagesRaw, chatAllMessagesRaw.length])
  const activeVisibleMessageIds = React.useMemo(() => new Set(allMessages.map((message: any) => String(message?.id || '').trim()).filter(Boolean)), [allMessages])
  const activeVisibleHeadMid = allMessages.length ? String(allMessages[allMessages.length - 1]?.id || '').trim() : ''
  const activeVisibleRunCards = React.useMemo(
    () => filterEbRoleRunCardsOnMessagePath(activeSessionRunCards, activeVisibleMessageIds, activeVisibleHeadMid),
    [activeSessionRunCardsKey, activeVisibleMessageIds, activeVisibleHeadMid],
  )
  const latestActiveVisibleRunCard = activeVisibleRunCards.length ? activeVisibleRunCards[activeVisibleRunCards.length - 1] : null
  const activeStopRunCard = activeChatRunCards.length ? activeChatRunCards[activeChatRunCards.length - 1] : null
  const activeStopRunId = String(activeStopRunCard?.runId || latestActiveVisibleRunCard?.runId || '').trim()
  const activeRunCardForMessage = (message: any) => {
    return activeRunCardForAssistantMessage(activeVisibleRunCards, message)
  }

  const assistantSiblingsByPrevAiMid = React.useMemo(() => {
    const map = new Map<string, any[]>()
    for (const m of chatAllMessagesRaw) {
      if (!m || m.role !== 'assistant') continue
      const mid = String(m?.id || '').trim()
      if (!mid) continue
      const prevAiMid = String(prevAiMidByAssistantId.get(mid) || '').trim()
      if (!prevAiMid) continue
      const list = map.get(prevAiMid) || []
      list.push(m)
      map.set(prevAiMid, list)
    }
    for (const [k, list] of map.entries()) {
      list.sort((a: any, b: any) => {
        const da = Number(a?.createdAt || 0)
        const db = Number(b?.createdAt || 0)
        if (da !== db) return da - db
        return String(a?.id || '').localeCompare(String(b?.id || ''))
      })
      map.set(k, list)
    }
    return map
  }, [chatAllMessagesRaw, chatAllMessagesRaw.length, Number((renderChat as any)?.updatedAt || 0), prevAiMidByAssistantId])
  const msgIndexById = React.useMemo(() => {
    const m = new Map<string, number>()
    for (let i = 0; i < allMessages.length; i++) {
      const id = String(allMessages[i]?.id || '')
      if (!id) continue
      if (!m.has(id)) m.set(id, i)
    }
    return m
  }, [allMessages])
  const groupedAttMsgsByRootMid = React.useMemo(() => {
    const map = new Map<string, any[]>()
    for (const m of allMessages) {
      if (!m || chatMessageMaterialKind(m) !== 'user') continue
      if (String(m?.groupRole || '') !== 'attachment') continue
      const parent = String(m?.groupParentMid || '').trim()
      if (!parent) continue
      const list = map.get(parent) || []
      list.push(m)
      map.set(parent, list)
    }
    return map
  }, [allMessages])
  const renderMessages = React.useMemo(() => {
    const out: any[] = []
    for (const m of allMessages) {
      if (!m) continue
      const hasActiveRun = !!activeRunCardForMessage(m) && isAssistantGenerating(m)
      if (isStaleAssistantPlaceholder(m, hasActiveRun)) continue
      if (chatMessageMaterialKind(m) !== 'user') {
        out.push(m)
        continue
      }
      if (String(m?.groupRole || '') === 'attachment' && String(m?.groupParentMid || '').trim()) continue
      out.push(m)
    }
    return out
  }, [allMessages, activeSessionRunCardsKey, activeVisibleRunCards])
  const showActiveRunTailPending = !!latestActiveVisibleRunCard && !renderMessages.some((message: any) => !!activeRunCardForMessage(message) && isAssistantGenerating(message))
  const activeRunTailPendingMessage = React.useMemo(() => {
    if (!showActiveRunTailPending || !latestActiveVisibleRunCard) return null
    const runId = String(latestActiveVisibleRunCard?.runId || '').trim()
    if (!runId) return null
    const t = Number(latestActiveVisibleRunCard?.createdAt || latestActiveVisibleRunCard?.updatedAt || Date.now())
    return {
      id: `__ui_active_run_tail_pending:${runId}`,
      role: 'assistant',
      content: ASSISTANT_RUNNING_CONTENT,
      pending: true,
      streaming: !!latestActiveVisibleRunCard?.stream,
      createdAt: isFinite(t) && t > 0 ? t : Date.now(),
      speakerRoleId: activeTargetKind === 'group' ? String(latestActiveVisibleRunCard?.roleId || '').trim() : '',
      displayOnlyPendingRunTail: true,
      assistantRun: {
        generationId: runId,
        status: 'running',
        mode: 'new',
        stream: !!latestActiveVisibleRunCard?.stream,
        startedAt: isFinite(t) && t > 0 ? t : Date.now(),
        updatedAt: Number(latestActiveVisibleRunCard?.updatedAt || t || Date.now()),
      },
    }
  }, [showActiveRunTailPending, latestActiveVisibleRunCard, activeTargetKind])
  const displayRenderMessages = React.useMemo(() => activeRunTailPendingMessage ? [...renderMessages, activeRunTailPendingMessage] : renderMessages, [activeRunTailPendingMessage, renderMessages])
  const activeContextTokenUsage = React.useMemo(() => sumMessageTokenEstimate(allMessages), [allMessages])
  const activeContextTokenUsageText = React.useMemo(() => formatTokenEstimate(activeContextTokenUsage), [activeContextTokenUsage])
  const activeContextTokenUsageShortText = React.useMemo(() => formatTokenEstimateShort(activeContextTokenUsage), [activeContextTokenUsage])
  const activeAsyncToolTasks = React.useMemo(() => (Array.isArray((activeChat as any)?.asyncToolTasks) ? (activeChat as any).asyncToolTasks : []), [activeChat, Number((activeChat as any)?.updatedAt || 0)])
  const activeAsyncToolTaskRunningCount = activeAsyncToolTasks.filter((task: any) => String(task?.status || '').trim() === 'running').length

  const lastMsg = renderMessages.length ? renderMessages[renderMessages.length - 1] : null
  const lastMsgId = String(lastMsg?.id || '')
  const lastMsgText = messageVisibleText(lastMsg)

  return {
    allMessages,
    activeVisibleMessageIds,
    activeVisibleHeadMid,
    activeVisibleRunCards,
    latestActiveVisibleRunCard,
    activeStopRunCard,
    activeStopRunId,
    activeRunCardForMessage,
    assistantSiblingsByPrevAiMid,
    msgIndexById,
    groupedAttMsgsByRootMid,
    renderMessages,
    showActiveRunTailPending,
    activeRunTailPendingMessage,
    displayRenderMessages,
    activeContextTokenUsage,
    activeContextTokenUsageText,
    activeContextTokenUsageShortText,
    activeAsyncToolTasks,
    activeAsyncToolTaskRunningCount,
    lastMsg,
    lastMsgId,
    lastMsgText,
  }
}
