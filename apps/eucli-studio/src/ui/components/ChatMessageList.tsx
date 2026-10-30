import * as React from 'react'
import { Box, Stack } from '@mui/material'
import { isAssistantGenerating } from '../../domain/assistantRunState'
import type { MessageBatchGroup } from '../../domain/messageBatchMount'
import { messageOffscreenContentKey } from '../../domain/messageOffscreen'
import type { MessageMutationOperation } from '../../domain/messageMutationConflicts'
import type { ReasoningDisplayMode } from '../../domain/reasoningDisplay'
import type { MessageOffscreenHandle } from '../hooks/useMessageOffscreen'
import { buildChatListIndex } from './ChatListIndex'
import { MessageRow, type MessageRowActions, type MessageRowUiPolicy } from './MessageRow'
import { MessageOffscreenSlot } from './MessageOffscreenSlot'

type MessageRole = 'user' | 'assistant'

const STAGING_MESSAGE_BATCH_SX = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  height: 0,
  overflow: 'hidden',
  visibility: 'hidden',
  pointerEvents: 'none',
} as const

type ChatMessageListProps = {
  controller: any
  messageBatchGroups?: MessageBatchGroup[]
  messageOffscreen?: MessageOffscreenHandle | null
  messages: any[]
  roles: any[]
  activeRole: any
  activeTargetKind: 'role' | 'group' | 'workspace'
  activeVisibleRunCards: any[]
  prevAiMidByAssistantId: Map<string, string>
  assistantSiblingsByPrevAiMid: Map<string, any[]>
  chatAllMessagesRaw: any[]
  expandedToolMsgIds: Set<string>
  expandedUserMsgIds: Set<string>
  editingMsg: { mid: string; text: string }
  loading: boolean
  uiBusy: boolean
  userMessageCollapseEnabled: boolean
  userMessageCollapseLines: number
  reasoningDisplayMode: ReasoningDisplayMode
  reasoningRenderEnabled: boolean
  stickersEnabled: boolean
  stickerMap: any
  renderSafetyPolicyKey: string
  chatRootRef: React.RefObject<HTMLDivElement | null>
  // 消息级缓存代际：同一会话共享一代，切会话即整代降级。
  cacheScope?: string
  formatModelRefText: (modelRef: any) => string
  messageMutationBlocked: (mid: any, operation?: MessageMutationOperation) => boolean
  onMessageContextMenu: (e: React.MouseEvent, mid: string, role: MessageRole) => void
  onToggleToolMessage: (mid: string) => void
  onToggleUserMessage: (mid: string) => void
  onEditTextChange: (text: string) => void
  onCancelEditMessage: () => void
  onSaveEditMessage: () => void | Promise<void>
  onStartEditMessage: (mid: string, text: string) => void
  onCopyMessageText: (text: unknown) => void
  onSwitchBranchSibling: (mid: string, direction: -1 | 1, nextMid: string) => void
  onRegenerate: (mid: string, role: MessageRole) => void
  onDeleteMessage: (mid: string, role: MessageRole) => void
}

function messageId(message: any) {
  return String(message?.id || '').trim()
}

// 没有分支兄弟时复用同一个空数组：行级 memo 只比引用，不能每次新建。
const EMPTY_SIBLINGS: any[] = []

// 消息区是整页最重的显示承载区。它只接收真实消息材料和消息内操作，
// 顶栏按钮、弹层开关、搜索输入等轻交互不能让这里重新构造每条消息。
//
// 性能契约（行级）：
//   - runCard / branchSiblings / branchIndex / nextAssistantMid 都在列表层一次性预建，行内 O(1) 读取；
//   - uiPolicy 与 actions 是单例对象，行级 memo 只比引用与布尔，不做深比较；
//   - 因此「切到已缓存会话」时已上屏行的 MessageRow 渲染次数为 0。
export const ChatMessageList = React.memo(function ChatMessageList(props: ChatMessageListProps) {
  const {
    controller,
    messageBatchGroups = [],
    messageOffscreen = null,
    messages,
    roles,
    activeRole,
    activeTargetKind,
    activeVisibleRunCards,
    prevAiMidByAssistantId,
    assistantSiblingsByPrevAiMid,
    chatAllMessagesRaw,
    expandedToolMsgIds,
    expandedUserMsgIds,
    editingMsg,
    loading,
    uiBusy,
    userMessageCollapseEnabled,
    userMessageCollapseLines,
    reasoningDisplayMode,
    reasoningRenderEnabled,
    stickersEnabled,
    stickerMap,
    renderSafetyPolicyKey,
    chatRootRef,
    cacheScope,
    formatModelRefText,
    messageMutationBlocked,
    onMessageContextMenu,
    onToggleToolMessage,
    onToggleUserMessage,
    onEditTextChange,
    onCancelEditMessage,
    onSaveEditMessage,
    onStartEditMessage,
    onCopyMessageText,
    onSwitchBranchSibling,
    onRegenerate,
    onDeleteMessage,
  } = props

  const uiPolicy = React.useMemo<MessageRowUiPolicy>(
    () => ({
      activeTargetKind,
      roles,
      activeRole,
      loading,
      uiBusy,
      userMessageCollapseEnabled,
      userMessageCollapseLines,
      reasoningDisplayMode,
      reasoningRenderEnabled,
      stickersEnabled,
      stickerMap,
      renderSafetyPolicyKey,
      formatModelRefText,
    }),
    [
      activeTargetKind,
      roles,
      activeRole,
      loading,
      uiBusy,
      userMessageCollapseEnabled,
      userMessageCollapseLines,
      reasoningDisplayMode,
      reasoningRenderEnabled,
      stickersEnabled,
      stickerMap,
      renderSafetyPolicyKey,
      formatModelRefText,
    ],
  )

  // actions 单例：handler 全部来自 useEvent（身份稳定），所以这个对象在 controller 生命周期内不变。
  const actions = React.useMemo<MessageRowActions>(
    () => ({
      messageMutationBlocked,
      onMessageContextMenu,
      onToggleToolMessage,
      onToggleUserMessage,
      onEditTextChange,
      onCancelEditMessage,
      onSaveEditMessage,
      onStartEditMessage,
      onCopyMessageText,
      onSwitchBranchSibling,
      onRegenerate,
      onDeleteMessage,
    }),
    [
      messageMutationBlocked,
      onMessageContextMenu,
      onToggleToolMessage,
      onToggleUserMessage,
      onEditTextChange,
      onCancelEditMessage,
      onSaveEditMessage,
      onStartEditMessage,
      onCopyMessageText,
      onSwitchBranchSibling,
      onRegenerate,
      onDeleteMessage,
    ],
  )

  // 预建索引：run 卡、分支兄弟与位置、用户消息的「下一条 AI」。
  // 全部 O(n) 一次，替代原先每行 findIndex / 线性扫卡的 O(n²)。
  const index = React.useMemo(
    () => buildChatListIndex({
      messages,
      chatAllMessagesRaw,
      activeVisibleRunCards,
      prevAiMidByAssistantId,
      assistantSiblingsByPrevAiMid,
    }),
    [messages, chatAllMessagesRaw, activeVisibleRunCards, prevAiMidByAssistantId, assistantSiblingsByPrevAiMid],
  )

  const renderRow = React.useCallback(
    (m: any) => {
      const mid = messageId(m)
      const body = (
        <MessageRow
          key={mid || undefined}
          controller={controller}
          mid={mid}
          message={m}
          runCard={index.runCardByMid.get(mid) || null}
          branchSiblings={index.branchSiblingsByMid.get(mid) || EMPTY_SIBLINGS}
          branchIndex={index.branchIndexByMid.get(mid) ?? -1}
          nextAssistantMid={index.nextAssistantMidByUserMid.get(mid) || ''}
          isUserExpanded={!!mid && expandedUserMsgIds.has(mid)}
          isToolExpanded={!!mid && expandedToolMsgIds.has(mid)}
          isEditing={!!mid && editingMsg.mid === mid}
          editingText={editingMsg.mid === mid ? editingMsg.text : ''}
          uiPolicy={uiPolicy}
          actions={actions}
          chatRootRef={chatRootRef}
          cacheScope={String(cacheScope || '')}
        />
      )
      if (!messageOffscreen || !mid) return body
      const card = index.runCardByMid.get(mid) || null
      const pinned = !!m?.displayOnlyPendingRunTail || (!!card && isAssistantGenerating(m))
      const contentKey = messageOffscreenContentKey(m, {
        editing: editingMsg.mid === mid,
        editingLength: editingMsg.mid === mid ? editingMsg.text.length : 0,
        userExpanded: expandedUserMsgIds.has(mid),
        toolExpanded: expandedToolMsgIds.has(mid),
      })
      return (
        <MessageOffscreenSlot
          key={mid}
          controller={messageOffscreen}
          mid={mid}
          pinned={pinned}
          contentKey={contentKey}
          message={m}
        >
          {body}
        </MessageOffscreenSlot>
      )
    },
    [
      controller,
      index,
      expandedUserMsgIds,
      expandedToolMsgIds,
      editingMsg,
      uiPolicy,
      actions,
      chatRootRef,
      cacheScope,
      messageOffscreen,
    ],
  )

  return (
    <Stack spacing={1.25} useFlexGap sx={{ position: 'relative' }}>
      {messageBatchGroups.map((batch) => (
        <Box
          key={batch.key}
          data-fw-message-batch={batch.revealed ? 'revealed' : 'staging'}
          aria-hidden={batch.revealed ? undefined : true}
          sx={batch.revealed ? undefined : STAGING_MESSAGE_BATCH_SX}
        >
          <Stack spacing={1.25} useFlexGap>{batch.messages.map(renderRow)}</Stack>
        </Box>
      ))}
      {messages.map(renderRow)}
    </Stack>
  )
})
