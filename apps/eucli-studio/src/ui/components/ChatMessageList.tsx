import * as React from 'react'
import { Box, Collapse, Paper, Stack, Typography } from '@mui/material'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import { isAssistantGenerating } from '../../domain/assistantRunState'
import type { MessageBatchGroup } from '../../domain/messageBatchMount'
import { messageOffscreenContentKey } from '../../domain/messageOffscreen'
import type { MessageMutationOperation } from '../../domain/messageMutationConflicts'
import type { ReasoningDisplayMode } from '../../domain/reasoningDisplay'
import { findToolProcessRanges } from '../../domain/toolProcessDivider'
import type { MessageOffscreenHandle } from '../hooks/useMessageOffscreen'
import { buildChatListIndex } from './ChatListIndex'
import { MessageRow, type MessageRowActions, type MessageRowUiPolicy } from './MessageRow'
import { MessageOffscreenSlot } from './MessageOffscreenSlot'
import { useRenderProbe } from '../../diagnostics/renderProbe'

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
  useRenderProbe('messageList')

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

  // 每一段工具过程渲染成一块：上下两根绿线之间铺主题色半透明底板。
  // 消息仍然由 renderRow 原样产出，只是被放在这层底板里。
  // 每一段工具过程可手动收起：展开时铺主题色底板，收起时只剩一条统计。
  const [collapsedToolProcess, setCollapsedToolProcess] = React.useState<Set<string>>(() => new Set())
  const toggleToolProcess = React.useCallback((key: string) => {
    setCollapsedToolProcess((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])
  React.useEffect(() => setCollapsedToolProcess(new Set()), [cacheScope])

  // 已揭示的历史批次与尾部可见区处在同一条时间线上：分批上屏只决定「谁先可交互」，
  // 不该成为工作过程区间的语义边界——否则更早的一批工具过程永远落不进任何区间。
  // staging 批次仍是独立的屏外暂存容器，不参与区间识别。
  const revealedFlow = React.useMemo(() => {
    const flow: any[] = []
    for (const batch of messageBatchGroups) {
      if (!batch.revealed) continue
      for (const message of batch.messages) flow.push(message)
    }
    for (const message of messages) flow.push(message)
    return flow
  }, [messageBatchGroups, messages])

  const stagingBatches = React.useMemo(
    () => messageBatchGroups.filter((batch) => !batch.revealed),
    [messageBatchGroups],
  )

  const messageRows = React.useMemo(() => {
    const rows: React.ReactNode[] = []
    let cursor = 0
    for (const range of findToolProcessRanges(revealedFlow)) {
      for (let index = cursor; index < range.start; index++) rows.push(renderRow(revealedFlow[index]))
      const key = `tool-process:${messageId(revealedFlow[range.start]) || range.start}`
      const onToggle = () => toggleToolProcess(key)
      const collapsed = collapsedToolProcess.has(key)
      rows.push(
        <Box
          key={key}
          sx={{
            borderRadius: 3,
            overflow: 'hidden',
            bgcolor: 'color-mix(in srgb, var(--studio-primary) 10%, transparent)',
          }}
        >
          {toolProcessBar('start', range, !collapsed, onToggle)}
          <Collapse in={!collapsed} timeout={180} unmountOnExit>
            <Stack spacing={1.25} sx={{ pt: 1.25 }}>
              {revealedFlow.slice(range.start, range.end + 1).map(renderRow)}
              {toolProcessBar('end', range, true, onToggle)}
            </Stack>
          </Collapse>
        </Box>,
      )
      cursor = range.end + 1
    }
    for (let index = cursor; index < revealedFlow.length; index++) rows.push(renderRow(revealedFlow[index]))
    return rows
  }, [revealedFlow, renderRow, collapsedToolProcess, toggleToolProcess])

  return (
    <Stack spacing={1.25} useFlexGap sx={{ position: 'relative' }}>
      {stagingBatches.map((batch) => (
        <Box key={batch.key} data-fw-message-batch="staging" aria-hidden sx={STAGING_MESSAGE_BATCH_SX}>
          <Stack spacing={1.25} useFlexGap>{batch.messages.map(renderRow)}</Stack>
        </Box>
      ))}
      {messageRows}
    </Stack>
  )
})

// 工具过程的上界 / 下界：沿用工具调用卡片的纸面、标题层级与展开图标。
// 上下两条同构，箭头只反映当前是展开还是收起。
function toolProcessBar(
  edge: 'start' | 'end',
  range: { rounds: number; toolCalls: number },
  expanded: boolean,
  onToggle: () => void,
) {
  return (
    <Paper
      elevation={0}
      data-tool-process-divider={edge}
      role="button"
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onToggle()
        }
      }}
      sx={{
        background: 'var(--studio-paper)',
        boxShadow: 'var(--studio-shadow-soft)',
        cursor: 'pointer',
        userSelect: 'none',
      }}
    >
      <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 1.25, py: 1, minWidth: 0 }}>
        <Box
          aria-hidden
          sx={{
            width: 20,
            height: 20,
            flexShrink: 0,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: 'var(--studio-success-bg)',
            color: 'var(--studio-success-text)',
          }}
        >
          <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: 'currentColor' }} />
        </Box>
        <Stack spacing={0.15} sx={{ minWidth: 0 }}>
          <Typography variant="body2" noWrap sx={{ fontWeight: 950, color: 'var(--studio-text-primary)' }}>
            工作过程
          </Typography>
          <Typography
            variant="caption"
            noWrap
            sx={{ color: 'var(--studio-text-secondary)', fontVariantNumeric: 'tabular-nums' }}
          >
            {range.rounds} 轮 · {range.toolCalls} 次工具调用
          </Typography>
        </Stack>
        <Box sx={{ flex: 1 }} />
        {expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
      </Stack>
    </Paper>
  )
}
