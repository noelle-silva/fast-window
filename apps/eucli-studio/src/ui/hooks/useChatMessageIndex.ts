import * as React from 'react'
import { readActiveEbRunCardsForTarget } from '../../domain/activeRunCards'
import { assistantRunGenerationId } from '../../domain/assistantRunState'
import type { SendPathAnchor } from './useChatSending'

type TargetKind = 'role' | 'group' | 'workspace'

export function useChatMessageIndex(deps: {
  s: any
  renderChat: any
  renderChatId: string
  activeChatId: string
  activeChat: any
  activeTargetKind: TargetKind
  activeChatTargetId: any
  sendPathAnchor: SendPathAnchor
}) {
  const { s, renderChat, renderChatId, activeChatId, activeChat, activeTargetKind, activeChatTargetId, sendPathAnchor } = deps

  const chatAllMessagesRaw: any[] = Array.isArray(renderChat?.messages) ? (renderChat.messages as any[]) : []
  const chatAllById = React.useMemo(() => {
    const m = new Map<string, any>()
    for (const it of chatAllMessagesRaw) {
      const id = String(it?.id || '').trim()
      if (!id || m.has(id)) continue
      m.set(id, it)
    }
    return m
  }, [chatAllMessagesRaw, chatAllMessagesRaw.length, Number((renderChat as any)?.updatedAt || 0)])
  const chatAllIndexById = React.useMemo(() => {
    const m = new Map<string, number>()
    for (let i = 0; i < chatAllMessagesRaw.length; i++) {
      const id = String(chatAllMessagesRaw[i]?.id || '').trim()
      if (!id || m.has(id)) continue
      m.set(id, i)
    }
    return m
  }, [chatAllMessagesRaw, chatAllMessagesRaw.length, Number((renderChat as any)?.updatedAt || 0)])
  const prevAiMidByAssistantId = React.useMemo(() => {
    const out = new Map<string, string>()
    const msgs = chatAllMessagesRaw

    const findPrevAi = (assistantMid: string) => {
      const aiIndex = chatAllIndexById.get(assistantMid)
      if (aiIndex == null || aiIndex < 0) return ''
      const target = msgs[aiIndex]
      if (!target || target.role !== 'assistant') return ''

      let userMid = String((target as any)?.parentMid || '').trim()
      let userMsg = userMid ? (chatAllById.get(userMid) || null) : null
      if (!userMsg || userMsg.role !== 'user') {
        for (let i = aiIndex - 1; i >= 0; i--) {
          const m = msgs[i]
          if (m && m.role === 'user') {
            userMsg = m
            userMid = String(m?.id || '').trim()
            break
          }
          if (m && m.role === 'assistant') break
        }
      }
      if (!userMsg || userMsg.role !== 'user') return ''

      const p0 = String((userMsg as any)?.parentMid || '').trim()
      const pMsg = p0 ? (chatAllById.get(p0) || null) : null
      if (pMsg && pMsg.role === 'assistant') return String(pMsg?.id || '').trim()

      const uidx = userMid ? (chatAllIndexById.get(userMid) ?? -1) : -1
      const start = uidx >= 0 ? uidx - 1 : aiIndex - 1
      for (let i = start; i >= 0; i--) {
        const m = msgs[i]
        if (m && m.role === 'assistant') return String(m?.id || '').trim()
      }
      return ''
    }

    for (const m of msgs) {
      if (!m || m.role !== 'assistant') continue
      const mid = String(m?.id || '').trim()
      if (!mid || out.has(mid)) continue
      out.set(mid, findPrevAi(mid))
    }
    return out
  }, [chatAllMessagesRaw, chatAllMessagesRaw.length, Number((renderChat as any)?.updatedAt || 0), chatAllById, chatAllIndexById])
  const activeSessionRunCards = readActiveEbRunCardsForTarget(s, activeTargetKind, String(activeChatTargetId || ''), renderChatId)
  const activeSessionRunCardsKey = activeSessionRunCards
    .map((card: any) => `${String(card?.runId || '')}:${String(card?.lastMessageId || '')}:${String(card?.status || '')}:${String(card?.retry?.attempt || '')}:${String(card?.retry?.retryAt || '')}:${String(card?.retry?.failure?.message || '')}:${Number(card?.updatedAt || 0)}`)
    .join('|')
  const activeChatRunCards = renderChatId === activeChatId ? activeSessionRunCards : readActiveEbRunCardsForTarget(s, activeTargetKind, String(activeChatTargetId || ''), activeChatId)
  const activeBranchIdUi = String((activeChat as any)?.branching?.activeBranchId || '')
  const activeSendPathAnchorMid =
    String(sendPathAnchor.chatId || '') === String(activeChat?.id || '') ? String(sendPathAnchor.parentMid || '').trim() : ''
  const activeSendPathRunId = activeSendPathAnchorMid ? String(sendPathAnchor.runId || '').trim() : ''
  const activeSendPathRunCard = activeSendPathRunId ? activeSessionRunCards.find((card: any) => String(card?.runId || '').trim() === activeSendPathRunId) || null : null
  const activeSendPathFollowMid = React.useMemo(() => {
    if (!renderChat || !activeSendPathAnchorMid) return ''
    const existingIds = new Set(Array.isArray(sendPathAnchor.existingMessageIds) ? sendPathAnchor.existingMessageIds.map((id: any) => String(id || '').trim()).filter(Boolean) : [])
    const canFollowRunMid = (mid0: any) => {
      const mid = String(mid0 || '').trim()
      return !!mid && chatAllById.has(mid) && !existingIds.has(mid)
    }
    const runCardMid = String(activeSendPathRunCard?.lastMessageId || '').trim()
    if (canFollowRunMid(runCardMid)) return runCardMid

    if (activeSendPathRunId) {
      for (let i = chatAllMessagesRaw.length - 1; i >= 0; i--) {
        const message = chatAllMessagesRaw[i]
        if (!message || String(message?.role || '') !== 'assistant') continue
        if (assistantRunGenerationId(message) === activeSendPathRunId) return String(message?.id || '').trim()
      }
    }

    const lastMid = String(sendPathAnchor.lastMessageId || '').trim()
    if (canFollowRunMid(lastMid)) return lastMid

    const inputMid = String(sendPathAnchor.inputMessageId || '').trim()
    if (canFollowRunMid(inputMid)) return inputMid
    return activeSendPathAnchorMid
  }, [renderChatId, activeSendPathAnchorMid, activeSendPathRunCard, activeSendPathRunId, sendPathAnchor.lastMessageId, sendPathAnchor.inputMessageId, sendPathAnchor.existingMessageIds, chatAllById, chatAllMessagesRaw, chatAllMessagesRaw.length])
  const activeBranchHeadMid = React.useMemo(() => {
    const chat: any = activeChat
    if (!chat) return ''
    const branching = chat?.branching
    const bid = String(branching?.activeBranchId || 'main').trim() || 'main'
    const branches = Array.isArray(branching?.branches) ? branching.branches : []
    const b = branches.find((x: any) => String(x?.id || '') === bid) || null
    return String(b?.headMid || '').trim()
  }, [String(activeChat?.id || ''), Number((activeChat as any)?.updatedAt || 0), activeBranchIdUi])

  return {
    chatAllMessagesRaw,
    chatAllById,
    chatAllIndexById,
    prevAiMidByAssistantId,
    activeSessionRunCards,
    activeSessionRunCardsKey,
    activeChatRunCards,
    activeBranchIdUi,
    activeSendPathAnchorMid,
    activeSendPathRunId,
    activeSendPathRunCard,
    activeSendPathFollowMid,
    activeBranchHeadMid,
  }
}
