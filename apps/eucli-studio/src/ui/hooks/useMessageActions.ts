import * as React from 'react'
import { messageVisibleText } from '../../domain/chatMessageDisplay'
import { createMessageMutationGuard, type MessageMutationOperation } from '../../domain/messageMutationConflicts'
import { useEvent } from './useEvent'

type MessageRole = 'user' | 'assistant'

export function useMessageActions(deps: {
  controller: any
  loading: boolean
  page: 'chat' | 'settings'
  activeChat: any
  activeRoleId: string
  activeBranchIdUi: string
  branchDraftKey: string
  userMessageCollapseEnabled: boolean
  renderChat: any
  renderChatId: string
  activeSessionRunCards: any[]
  activeSessionRunCardsKey: string
  chatAllById: Map<string, any>
  clearSendPathAnchor: () => void
  setBranchNav: React.Dispatch<React.SetStateAction<{ mid: string; at: number }>>
  stickToBottomRef: React.MutableRefObject<boolean>
  autoScrollBlockUntilRef: React.MutableRefObject<number>
  treeSuppressClickRef: React.MutableRefObject<boolean>
}) {
  const {
    controller,
    loading,
    page,
    activeChat,
    activeRoleId,
    activeBranchIdUi,
    branchDraftKey,
    userMessageCollapseEnabled,
    renderChat,
    renderChatId,
    activeSessionRunCards,
    activeSessionRunCardsKey,
    chatAllById,
    clearSendPathAnchor,
    setBranchNav,
    stickToBottomRef,
    autoScrollBlockUntilRef,
    treeSuppressClickRef,
  } = deps

  const [expandedUserMsgIds, setExpandedUserMsgIds] = React.useState(() => new Set<string>())
  const [expandedToolMsgIds, setExpandedToolMsgIds] = React.useState(() => new Set<string>())

  React.useEffect(() => {
    setExpandedUserMsgIds(() => new Set())
    setExpandedToolMsgIds(() => new Set())
  }, [String(activeChat?.id || '')])

  React.useEffect(() => {
    if (!userMessageCollapseEnabled) setExpandedUserMsgIds(() => new Set())
  }, [userMessageCollapseEnabled])

  const toggleExpandedUserMsg = useEvent((mid: string) => {
    const id = String(mid || '')
    if (!id) return
    setExpandedUserMsgIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  })

  const toggleExpandedToolMsg = useEvent((mid: string) => {
    const id = String(mid || '')
    if (!id) return
    setExpandedToolMsgIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  })

  const messageMutationGuard = React.useMemo(
    () => createMessageMutationGuard(renderChat, { activeRunCards: activeSessionRunCards }),
    [renderChat, renderChatId, Number((renderChat as any)?.updatedAt || 0), activeSessionRunCardsKey],
  )
  const messageMutationBlocked = useEvent((mid: any, operation: MessageMutationOperation = 'edit') => {
    if (loading) return true
    return messageMutationGuard.blocked(mid, operation)
  })

  const [regen, setRegen] = React.useState<{ mid: string; role: MessageRole }>({ mid: '', role: 'assistant' })
  const [msgMenu, setMsgMenu] = React.useState<{ mid: string; role: MessageRole; x: number; y: number }>({
    mid: '',
    role: 'assistant',
    x: 0,
    y: 0,
  })
  const [treeNodeMenu, setTreeNodeMenu] = React.useState<{ mid: string; role: MessageRole; x: number; y: number }>({
    mid: '',
    role: 'assistant',
    x: 0,
    y: 0,
  })
  const [confirmDelMsg, setConfirmDelMsg] = React.useState<{ mid: string; role: MessageRole }>({ mid: '', role: 'assistant' })
  const [confirmDelTree, setConfirmDelTree] = React.useState<{ mid: string; role: MessageRole }>({
    mid: '',
    role: 'assistant',
  })
  const [editingMsg, setEditingMsg] = React.useState<{ mid: string; text: string }>({ mid: '', text: '' })

  React.useEffect(() => {
    setEditingMsg({ mid: '', text: '' })
  }, [page, activeRoleId, activeChat?.id, activeBranchIdUi, branchDraftKey])

  React.useEffect(() => {
    if (page !== 'chat') return
    const mid = String(editingMsg.mid || '')
    if (!mid) return
    const msgs = Array.isArray(renderChat?.messages) ? renderChat.messages : []
    if (!msgs.some((m: any) => String(m?.id || '') === mid)) setEditingMsg({ mid: '', text: '' })
  }, [page, renderChatId, (renderChat?.messages || []).length, editingMsg.mid])

  const closeMsgMenu = useEvent(() => setMsgMenu({ mid: '', role: 'assistant', x: 0, y: 0 }))
  const onMessageContextMenu = useEvent((e: React.MouseEvent, mid: string, role: MessageRole) => {
    if (!mid) return
    e.preventDefault()
    e.stopPropagation()
    setMsgMenu({ mid, role, x: e.clientX, y: e.clientY })
  })

  const closeTreeNodeMenu = useEvent(() => setTreeNodeMenu({ mid: '', role: 'assistant', x: 0, y: 0 }))
  const onTreeNodeContextMenu = useEvent((e: any, mid: string, role: MessageRole) => {
    const id = String(mid || '').trim()
    if (!id) return
    try {
      e.preventDefault?.()
      e.stopPropagation?.()
    } catch (_) {}
    treeSuppressClickRef.current = true
    setTimeout(() => {
      treeSuppressClickRef.current = false
    }, 0)
    setTreeNodeMenu({ mid: id, role, x: Number(e?.clientX || 0), y: Number(e?.clientY || 0) })
  })

  const startEditMessage = useEvent((mid: string, text: string) => {
    if (!mid) return
    if (messageMutationBlocked(mid, 'edit')) return
    setEditingMsg({ mid, text: String(text ?? '') })
  })
  const setEditingMsgText = useEvent((text: string) => setEditingMsg((p) => ({ ...p, text: String(text ?? '') })))
  const cancelEditMessage = useEvent(() => setEditingMsg({ mid: '', text: '' }))
  const saveEditMessage = useEvent(async () => {
    const mid = String(editingMsg.mid || '')
    if (!mid) return
    if (messageMutationBlocked(mid, 'edit')) return
    const ok = await Promise.resolve(controller.actions.editMessage?.(mid, String(editingMsg.text ?? '')))
    if (ok === true) setEditingMsg({ mid: '', text: '' })
  })

  const copyMessageText = useEvent((text: unknown) => {
    const writeText = controller.capabilities?.clipboard?.writeText
    if (typeof writeText !== 'function') return controller.capabilities?.ui?.showToast?.('未授权：clipboard.writeText', { kind: 'error' })
    Promise.resolve()
      .then(() => writeText(String(text ?? '')))
      .then(
        () => controller.capabilities?.ui?.showToast?.('已复制', { kind: 'success' }),
        () => controller.capabilities?.ui?.showToast?.('复制失败', { kind: 'error' }),
      )
  })

  const switchBranchSibling = useEvent((mid: string, direction: -1 | 1, nextMid: string) => {
    const id = String(mid || '').trim()
    if (!id) return
    stickToBottomRef.current = false
    autoScrollBlockUntilRef.current = Date.now() + 1200
    clearSendPathAnchor()
    const followMid = String(nextMid || '').trim()
    if (followMid) setBranchNav({ mid: followMid, at: Date.now() })
    controller.actions.switchBranchSibling?.(id, direction)
  })

  const openRegenConfirm = useEvent((mid: string, role: MessageRole) => {
    const id = String(mid || '').trim()
    if (!id) return
    setRegen({ mid: id, role: role === 'user' ? 'user' : 'assistant' })
  })

  const regenPathParentMid = useEvent((mid0: string, role0: MessageRole) => {
    const mid = String(mid0 || '').trim()
    if (!mid) return ''
    if (role0 === 'user') return mid
    const message = chatAllById.get(mid) || null
    const parentMid = String((message as any)?.parentMid || '').trim()
    const parent = parentMid ? chatAllById.get(parentMid) || null : null
    return parent ? parentMid : ''
  })

  const openDeleteMessageConfirm = useEvent((mid: string, role: MessageRole) => {
    const id = String(mid || '').trim()
    if (!id) return
    setConfirmDelMsg({ mid: id, role: role === 'user' ? 'user' : 'assistant' })
  })

  const msgMenuMid = String(msgMenu.mid || '')
  const msgMenuMessages = Array.isArray(renderChat?.messages) ? renderChat.messages : []
  const msgMenuIndex = msgMenuMid ? msgMenuMessages.findIndex((m: any) => String(m?.id || '') === msgMenuMid) : -1
  const msgMenuMsg = msgMenuIndex >= 0 ? msgMenuMessages[msgMenuIndex] : null
  const msgMenuText = messageVisibleText(msgMenuMsg)
  const msgMenuIsToolResponse = msgMenuText.startsWith('<<<[TOOL_RESPONSE]>>>')
  const msgMenuCanEdit = !!msgMenuMid && !messageMutationBlocked(msgMenuMid, 'edit')

  let msgMenuRegenMid = msgMenuMid
  let msgMenuRegenRole: MessageRole = msgMenu.role === 'user' ? 'user' : 'assistant'
  let msgMenuRegenBlocked = msgMenu.role === 'assistant' ? messageMutationBlocked(msgMenuRegenMid, 'edit') : false
  if (msgMenu.role === 'user' && msgMenuIndex >= 0) {
    for (let j = msgMenuIndex + 1; j < msgMenuMessages.length; j++) {
      const next = msgMenuMessages[j]
      if (!next) continue
      if (next.role === 'assistant') {
        msgMenuRegenRole = 'assistant'
        msgMenuRegenMid = String(next?.id || '')
        msgMenuRegenBlocked = messageMutationBlocked(msgMenuRegenMid, 'edit')
        break
      }
    }
  }
  const msgMenuCanRegen = !!msgMenuRegenMid && !loading && !(msgMenuRegenRole === 'assistant' && msgMenuRegenBlocked)

  return {
    expandedUserMsgIds,
    setExpandedUserMsgIds,
    expandedToolMsgIds,
    setExpandedToolMsgIds,
    toggleExpandedUserMsg,
    toggleExpandedToolMsg,
    messageMutationGuard,
    messageMutationBlocked,
    regen,
    setRegen,
    msgMenu,
    setMsgMenu,
    treeNodeMenu,
    setTreeNodeMenu,
    confirmDelMsg,
    setConfirmDelMsg,
    confirmDelTree,
    setConfirmDelTree,
    editingMsg,
    setEditingMsg,
    closeMsgMenu,
    onMessageContextMenu,
    closeTreeNodeMenu,
    onTreeNodeContextMenu,
    startEditMessage,
    setEditingMsgText,
    cancelEditMessage,
    saveEditMessage,
    copyMessageText,
    switchBranchSibling,
    openRegenConfirm,
    regenPathParentMid,
    openDeleteMessageConfirm,
    msgMenuMid,
    msgMenuText,
    msgMenuIsToolResponse,
    msgMenuCanEdit,
    msgMenuRegenMid,
    msgMenuRegenRole,
    msgMenuCanRegen,
  }
}
