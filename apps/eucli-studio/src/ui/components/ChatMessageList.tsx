import * as React from 'react'
import { Box, CircularProgress, Collapse, Paper, Stack, Typography } from '@mui/material'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import { isAssistantGenerating } from '../../domain/assistantRunState'
import type { MessageBatchGroup } from '../../domain/messageBatchMount'
import { messageOffscreenContentKey } from '../../domain/messageOffscreen'
import type { MessageMutationOperation } from '../../domain/messageMutationConflicts'
import type { ReasoningDisplayMode } from '../../domain/reasoningDisplay'
import { workProcessExpandedByMode, type WorkProcessDisplayMode } from '../../domain/workProcessDisplay'
import { findToolProcessRanges } from '../../domain/toolProcessDivider'
import type { MessageOffscreenHandle } from '../hooks/useMessageOffscreen'
import { buildChatListIndex } from './ChatListIndex'
import { MessageRow, type MessageRowActions, type MessageRowUiPolicy } from './MessageRow'
import { MessageOffscreenSlot } from './MessageOffscreenSlot'
import { CustomScrollArea } from './CustomScrollArea'
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
  // 工作过程缩略显示：开关决定是否渲染统计块，档位决定默认展开状态。
  workProcessDisplayEnabled: boolean
  workProcessDisplayMode: WorkProcessDisplayMode
  // 展开内容内部滚动：开启后按高度上限滚动，不把整页撑长；宽度按百分比收窄。
  workProcessInnerScrollEnabled: boolean
  workProcessInnerScrollHeight: number
  workProcessInnerScrollWidth: number
  // 到边界后是否把余下的滚动交给外层消息区（默认关闭，边界即停）。
  workProcessInnerScrollChainingEnabled: boolean
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
    workProcessDisplayEnabled,
    workProcessDisplayMode,
    workProcessInnerScrollEnabled,
    workProcessInnerScrollHeight,
    workProcessInnerScrollWidth,
    workProcessInnerScrollChainingEnabled,
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
  // 用户手动点过的那一段：值即展开状态；没有记录时按档位与运行态决定。
  const [manualExpanded, setManualExpanded] = React.useState<Map<string, boolean>>(() => new Map())
  const toggleToolProcess = React.useCallback((key: string, expanded: boolean) => {
    setManualExpanded((current) => {
      const next = new Map(current)
      next.set(key, !expanded)
      return next
    })
  }, [])
  React.useEffect(() => setManualExpanded(new Map()), [cacheScope])

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
    // 关闭缩略显示时逐消息输出，不产生统计块。
    if (!workProcessDisplayEnabled) {
      for (const message of revealedFlow) rows.push(renderRow(message))
      return rows
    }
    let cursor = 0
    for (const range of findToolProcessRanges(revealedFlow, { isLive: isAssistantGenerating })) {
      for (let index = cursor; index < range.start; index++) rows.push(renderRow(revealedFlow[index]))
      const key = `tool-process:${messageId(revealedFlow[range.start]) || range.start}`
      // 「输出中」的判定：这一段里还有消息在生成。
      const active = revealedFlow
        .slice(range.start, range.end + 1)
        .some((message) => isAssistantGenerating(message))
      const manual = manualExpanded.get(key)
      const expanded = manual === undefined ? workProcessExpandedByMode(workProcessDisplayMode, active) : manual
      const onToggle = () => toggleToolProcess(key, expanded)
      rows.push(
        <Box
          key={key}
          sx={{
            borderRadius: 3,
            overflow: 'hidden',
            bgcolor: 'color-mix(in srgb, var(--studio-primary) 10%, transparent)',
            boxShadow: 'var(--studio-shadow-soft)',
            // 开内部滚动时整块按设置收窄并居中（上下限见 domain/workProcessDisplay）。
            ...(workProcessInnerScrollEnabled ? { width: `${workProcessInnerScrollWidth}%`, mx: 'auto' } : null),
          }}
        >
          {toolProcessBar('start', range, expanded, active, onToggle)}
          <Collapse in={expanded} timeout={180} unmountOnExit>
            {workProcessInnerScrollEnabled ? (
              <Box>
                {/* 到边界后的位移交给谁由设置里的「滚到边界继续传递」决定：
                    关闭时就地停住（contain），开启则走浏览器原生滚动链交给外层消息区。 */}
                <CustomScrollArea
                  axis="y"
                  hostSx={{ maxHeight: workProcessInnerScrollHeight }}
                  scrollSx={{
                    maxHeight: workProcessInnerScrollHeight,
                    pr: 1,
                    overscrollBehavior: workProcessInnerScrollChainingEnabled ? 'auto' : 'contain',
                  }}
                >
                  <Stack spacing={1.25} sx={{ pt: 1.25 }}>
                    {revealedFlow.slice(range.start, range.end + 1).map(renderRow)}
                  </Stack>
                </CustomScrollArea>
                {toolProcessBar('end', range, expanded, active, onToggle)}
              </Box>
            ) : (
              <Stack spacing={1.25} sx={{ pt: 1.25 }}>
                {revealedFlow.slice(range.start, range.end + 1).map(renderRow)}
                {toolProcessBar('end', range, expanded, active, onToggle)}
              </Stack>
            )}
          </Collapse>
        </Box>,
      )
      cursor = range.end + 1
    }
    for (let index = cursor; index < revealedFlow.length; index++) rows.push(renderRow(revealedFlow[index]))
    return rows
  }, [revealedFlow, renderRow, manualExpanded, toggleToolProcess, workProcessDisplayEnabled, workProcessDisplayMode, workProcessInnerScrollEnabled, workProcessInnerScrollHeight, workProcessInnerScrollWidth, workProcessInnerScrollChainingEnabled])

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
  range: { rounds: number; toolCalls: number; pendingConfirmations: number },
  expanded: boolean,
  active: boolean,
  onToggle: () => void,
) {
  const pending = range.pendingConfirmations > 0
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
            bgcolor: pending
              ? 'var(--studio-warning-bg)'
              : active
                ? 'var(--studio-divider)'
                : 'var(--studio-success-bg)',
            color: pending
              ? 'var(--studio-warning-text)'
              : active
                ? 'var(--studio-text-secondary)'
                : 'var(--studio-success-text)',
          }}
        >
          {active && !pending ? (
            <CircularProgress size={13} thickness={5} sx={{ color: 'currentColor' }} />
          ) : (
            <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: 'currentColor' }} />
          )}
        </Box>
        <Stack spacing={0.15} sx={{ minWidth: 0 }}>
          <Typography variant="body2" noWrap sx={{ fontWeight: 950, color: 'var(--studio-text-primary)' }}>
            工作过程
          </Typography>
          <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
            <Typography
              variant="caption"
              noWrap
              sx={{ color: 'var(--studio-text-secondary)', fontVariantNumeric: 'tabular-nums' }}
            >
              {range.rounds} 轮 · {range.toolCalls} 次工具调用
            </Typography>
            {pending ? (
              <Typography
                variant="caption"
                noWrap
                sx={{ color: 'var(--studio-warning-text)', fontWeight: 800, flexShrink: 0 }}
              >
                {range.pendingConfirmations} 个工具需要确认
              </Typography>
            ) : null}
          </Stack>
        </Stack>
        <Box sx={{ flex: 1 }} />
        {expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
      </Stack>
    </Paper>
  )
}
