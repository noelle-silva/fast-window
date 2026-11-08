import * as React from 'react'
import { readActiveEbRunCardsForTarget } from '../../domain/activeRunCards'

type TargetKind = 'role' | 'group' | 'workspace'

export function useChatMessageIndex(deps: {
  s: any
  renderChat: any
  renderChatId: string
  activeChatId: string
  activeChat: any
  activeTargetKind: TargetKind
  activeChatTargetId: any
}) {
  const { s, renderChat, renderChatId, activeChatId, activeChat, activeTargetKind, activeChatTargetId } = deps

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
  // 上一轮助手只按后台父子拓扑回溯：
  // assistant.parentMid 指向用户消息，用户消息的 parentMid 才是上一轮助手。
  // 禁止用数组顺序推断「上一个 AI 消息」，那是第二套拓扑。
  const prevAiMidByAssistantId = React.useMemo(() => {
    const out = new Map<string, string>()
    for (const message of chatAllMessagesRaw) {
      if (!message || message.role !== 'assistant') continue
      const mid = String(message?.id || '').trim()
      if (!mid || out.has(mid)) continue
      const userMid = String((message as any)?.parentMid || '').trim()
      const userMessage = userMid ? chatAllById.get(userMid) || null : null
      if (!userMessage || userMessage.role !== 'user') continue
      const prevAiMid = String((userMessage as any)?.parentMid || '').trim()
      const prevAi = prevAiMid ? chatAllById.get(prevAiMid) || null : null
      if (!prevAi || prevAi.role !== 'assistant') continue
      out.set(mid, prevAiMid)
    }
    return out
  }, [chatAllMessagesRaw, chatAllMessagesRaw.length, Number((renderChat as any)?.updatedAt || 0), chatAllById])
  const activeSessionRunCards = readActiveEbRunCardsForTarget(s, activeTargetKind, String(activeChatTargetId || ''), renderChatId)
  const activeSessionRunCardsKey = activeSessionRunCards
    .map((card: any) => `${String(card?.runId || '')}:${String(card?.lastMessageId || '')}:${String(card?.status || '')}:${String(card?.retry?.attempt || '')}:${String(card?.retry?.retryAt || '')}:${String(card?.retry?.failure?.message || '')}:${Number(card?.updatedAt || 0)}`)
    .join('|')
  const activeChatRunCards = renderChatId === activeChatId ? activeSessionRunCards : readActiveEbRunCardsForTarget(s, activeTargetKind, String(activeChatTargetId || ''), activeChatId)
  const activeBranchIdUi = String((activeChat as any)?.branching?.activeBranchId || '')
  return {
    chatAllMessagesRaw,
    chatAllById,
    chatAllIndexById,
    prevAiMidByAssistantId,
    activeSessionRunCards,
    activeSessionRunCardsKey,
    activeChatRunCards,
    activeBranchIdUi,
  }
}
