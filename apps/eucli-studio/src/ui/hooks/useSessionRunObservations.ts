import * as React from 'react'
import { readActiveEbRunCardsForTarget } from '../../domain/activeRunCards'
import { normalizeChatSessionRunStatus } from '../../domain/chatSessionRunStatus'
import type { ChatSessionRunIndicatorKind } from '../components/ChatSessionRunIndicator'
import {
  chatSessionRunNoticeKey,
  chatSessionRunSummaryFromListItem,
  collectChatSessionRunObservations,
  type ChatSessionRunNotice,
  type ChatSessionRunNoticeKind,
  type ChatSessionRunObservation,
} from '../chatSessionRunObservations'
import { useEvent } from './useEvent'

type TargetKind = 'role' | 'group' | 'workspace'

export function useSessionRunObservations(deps: {
  data: any
  s: any
  activeTargetKind: TargetKind
  activeChatTargetId: any
  activeChatId: any
}) {
  const { data, s, activeTargetKind, activeChatTargetId, activeChatId } = deps

  const [chatSessionRunNotices, setChatSessionRunNotices] = React.useState<Record<string, ChatSessionRunNotice>>({})
  const chatSessionRunStatusRef = React.useRef<Record<string, ChatSessionRunObservation>>({})

  React.useEffect(() => {
    const observations = collectChatSessionRunObservations(data)
    const previousByKey = chatSessionRunStatusRef.current
    const liveKeys = new Set<string>()
    const nextByKey: Record<string, ChatSessionRunObservation> = {}

    for (const observation of observations) {
      liveKeys.add(observation.key)
      nextByKey[observation.key] = observation
    }

    setChatSessionRunNotices((prev) => {
      let changed = false
      const next = { ...prev }

      for (const observation of observations) {
        const previous = previousByKey[observation.key]
        const terminal = observation.status === 'completed' || observation.status === 'interrupted'
        if (observation.status === 'running') {
          if (next[observation.key]) {
            delete next[observation.key]
            changed = true
          }
          continue
        }
        if (terminal && previous?.status === 'running') {
          const kind = observation.status as ChatSessionRunNoticeKind
          const changedAt = Number(observation.changedAt || 0)
          if (!next[observation.key] || next[observation.key].kind !== kind || Number(next[observation.key].changedAt || 0) !== changedAt) {
            next[observation.key] = { kind, changedAt }
            changed = true
          }
        }
      }

      for (const key of Object.keys(next)) {
        if (!liveKeys.has(key)) {
          delete next[key]
          changed = true
        }
      }

      return changed ? next : prev
    })

    chatSessionRunStatusRef.current = nextByKey
  })

  React.useEffect(() => {
    const key = chatSessionRunNoticeKey(activeTargetKind, activeChatTargetId, activeChatId)
    if (!key) return
    setChatSessionRunNotices((prev) => {
      if (!prev[key]) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  })

  const clearChatSessionRunNotice = useEvent((targetKind: TargetKind, targetId: string, chatId: string) => {
    const key = chatSessionRunNoticeKey(targetKind, targetId, chatId)
    if (!key) return
    setChatSessionRunNotices((prev) => {
      if (!prev[key]) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  })

  const chatSessionRunIndicatorKind = React.useCallback(
    (targetKind: TargetKind, targetId: string, chat: any, selected: boolean): ChatSessionRunIndicatorKind | '' => {
      const chatId = String(chat?.id || '').trim()
      const key = chatSessionRunNoticeKey(targetKind, targetId, chatId)
      if (!key) return ''
      const summary = chatSessionRunSummaryFromListItem(chat)
      if (summary.status === 'running') return 'running'
      if (selected) return ''
      const notice = chatSessionRunNotices[key]
      return notice ? notice.kind : ''
    },
    [chatSessionRunNotices],
  )

  const isSendingThisChat = React.useCallback(
    (targetKind: TargetKind, targetId: string, chatId: string) => {
      const tid = String(targetId || '')
      const cid = String(chatId || '')
      if (!tid || !cid) return false
      const box = targetKind === 'group' ? data?.chatsByGroup?.[tid] : targetKind === 'workspace' ? (data as any)?.chatsByWorkspace?.[tid] : data?.chatsByRole?.[tid]
      const meta = Array.isArray(box?.chatMetas) ? box.chatMetas.find((m: any) => String(m?.id || '') === cid) : null
      return readActiveEbRunCardsForTarget(s, targetKind, tid, cid).length > 0 || normalizeChatSessionRunStatus(meta?.runStatus || meta?.status) === 'running'
    },
    [s, data],
  )

  return {
    chatSessionRunNotices,
    clearChatSessionRunNotice,
    chatSessionRunIndicatorKind,
    isSendingThisChat,
  }
}
