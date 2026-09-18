import * as React from 'react'
import { Avatar, Box, Button, Chip, Collapse, IconButton, Paper, Stack, TextField, Tooltip, Typography } from '@mui/material'
import AttachFileIcon from '@mui/icons-material/AttachFile'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import StorageIcon from '@mui/icons-material/Storage'
import { isAssistantAwaitingFirstOutput, isAssistantGenerating } from '../../domain/assistantRunState'
import { activeRunCardForAssistantMessage, messageVisibleText } from '../../domain/chatMessageDisplay'
import { chatMessageMaterialKind, isAsyncToolResultMessage, isCompressionSummaryMessage, isSystemControlMessage } from '../../domain/message'
import type { MessageMutationOperation } from '../../domain/messageMutationConflicts'
import { AssistantErrorNotice } from './AssistantErrorNotice'
import { AssistantMessageBlocks } from './AssistantMessageBlocks'
import { AssistantReplyPendingIndicator } from './AssistantReplyPendingIndicator'
import { RefImageThumb, StickerText } from './MessageMedia'

type MessageRole = 'user' | 'assistant'

type ChatMessageListProps = {
  controller: any
  messages: any[]
  roles: any[]
  activeRole: any
  activeTargetKind: 'role' | 'group' | 'workspace'
  activeVisibleRunCards: any[]
  groupedAttMsgsByRootMid: Map<string, any[]>
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
  stickersEnabled: boolean
  stickerMap: any
  renderSafetyPolicyKey: string
  chatRootRef: React.RefObject<HTMLDivElement | null>
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
  onOpenAttachView: (e: React.MouseEvent<HTMLElement>, mid: string, idx: number) => void
  onSwitchBranchSibling: (mid: string, direction: -1 | 1, nextMid: string) => void
  onRegenerate: (mid: string, role: MessageRole) => void
  onDeleteMessage: (mid: string, role: MessageRole) => void
}

function clampNum(n: number, min: number, max: number) {
  const x = Number(n)
  if (!isFinite(x)) return min
  if (x < min) return min
  if (x > max) return max
  return x
}

function retryDelaySeconds(retry: any) {
  const retryAt = Date.parse(String(retry?.retryAt || ''))
  if (isFinite(retryAt) && retryAt > 0) return Math.max(0, Math.ceil((retryAt - Date.now()) / 1000))
  return Math.max(0, Math.ceil(Number(retry?.delayMs || 0) / 1000))
}

function runRetryLabel(retry: any) {
  if (!retry || typeof retry !== 'object') return ''
  const attempt = Math.max(0, Math.floor(Number(retry.attempt || 0)))
  const maxAttempts = Math.max(0, Math.floor(Number(retry.maxAttempts || 0)))
  if (!attempt || !maxAttempts) return ''
  const seconds = retryDelaySeconds(retry)
  const wait = seconds > 0 ? `，约 ${seconds} 秒后继续` : ''
  const message = String(retry.message || '模型请求失败，正在自动重试').trim()
  return `${message}${wait}`
}

function runRetryFailure(retry: any) {
  return retry?.failure && typeof retry.failure === 'object' ? retry.failure : null
}

// 消息区是整页最重的显示承载区。它只接收真实消息材料和消息内操作，
// 顶栏按钮、弹层开关、搜索输入等轻交互不能让这里重新构造每条消息。
export const ChatMessageList = React.memo(function ChatMessageList(props: ChatMessageListProps) {
  const {
    controller,
    messages,
    roles,
    activeRole,
    activeTargetKind,
    activeVisibleRunCards,
    groupedAttMsgsByRootMid,
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
    stickersEnabled,
    stickerMap,
    renderSafetyPolicyKey,
    chatRootRef,
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
    onOpenAttachView,
    onSwitchBranchSibling,
    onRegenerate,
    onDeleteMessage,
  } = props

  return (
    <Stack spacing={1.25}>
      {messages.map((m: any) => {
        const content = messageVisibleText(m)
        const isAsyncToolResult = isAsyncToolResultMessage(m)
        const isToolResponse = isAsyncToolResult || content.startsWith('<<<[TOOL_RESPONSE]>>>')
        const mid = String(m?.id || '')
        const isDisplayOnlyPendingRunTail = !!(m as any)?.displayOnlyPendingRunTail
        const isToolExpanded = !!mid && expandedToolMsgIds.has(mid)
        const isEditing = !isDisplayOnlyPendingRunTail && editingMsg.mid === mid

        if (isSystemControlMessage(m)) {
          const isSummary = isCompressionSummaryMessage(m)
          const time = controller.fmtTime(Number(m?.createdAt || 0))
          const retain = Math.max(0, Math.floor(Number(m?.control?.retainRecentMessages || 0)))
          const version = Math.max(0, Math.floor(Number(m?.control?.summaryVersion || 0)))
          return (
            <Stack key={mid} direction="row" justifyContent="center">
              <Paper
                variant="outlined"
                data-mid={mid}
                sx={{
                  width: '100%',
                  maxWidth: 980,
                  px: 1.5,
                  py: 1.2,
                  bgcolor: isSummary ? 'rgba(124, 58, 237, .055)' : 'rgba(15, 23, 42, .035)',
                  borderColor: isSummary ? 'rgba(124, 58, 237, .22)' : 'rgba(15, 23, 42, .12)',
                  borderRadius: 3,
                }}
              >
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: isSummary ? 0.75 : 0 }}>
                  <Chip size="small" color={isSummary ? 'secondary' : 'default'} label={isSummary ? '上下文摘要' : '压缩边界'} />
                  <Typography variant="body2" sx={{ fontWeight: 900 }}>
                    {isSummary ? '上下文摘要' : '已执行 /compact'}
                  </Typography>
                  {isSummary && retain ? (
                    <Typography variant="caption" color="text.secondary">
                      保留最近 {retain} 条原文
                    </Typography>
                  ) : null}
                  {isSummary && version ? (
                    <Typography variant="caption" color="text.secondary">
                      第 {version} 版
                    </Typography>
                  ) : null}
                  <Box sx={{ flex: 1 }} />
                  <Typography variant="caption" color="text.secondary">
                    {time}
                  </Typography>
                </Stack>
                {isSummary ? (
                  <Box
                    sx={{
                      whiteSpace: 'pre-wrap',
                      overflowWrap: 'anywhere',
                      wordBreak: 'break-word',
                      fontSize: 13,
                      lineHeight: 1.65,
                      bgcolor: 'rgba(255,255,255,.72)',
                      border: '1px solid rgba(124, 58, 237, .12)',
                      borderRadius: 2,
                      px: 1.25,
                      py: 1,
                    }}
                  >
                    {content}
                  </Box>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    {content || '上下文已压缩。'}
                  </Typography>
                )}
              </Paper>
            </Stack>
          )
        }

        if (isToolResponse) {
          const resultTags = content.match(/<<\[RESULT-\d+\]>>/g) || []
          const count = resultTags.length
          const names = Array.from(content.matchAll(/tool_name:「start」([\s\S]*?)「end」/g))
            .map((x) => String(x?.[1] || '').trim())
            .filter(Boolean)
          const statuses = Array.from(content.matchAll(/status:「start」([\s\S]*?)「end」/g))
            .map((x) => String(x?.[1] || '').trim())
            .filter(Boolean)
          const pairs = names.slice(0, 3).map((n, i) => {
            const st = statuses[i] || ''
            return st ? `${n}（${st}）` : n
          })
          const asyncSummary = content.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '异步工具返回'
          const summary = isAsyncToolResult ? asyncSummary : count ? `${count}项：${pairs.join('，')}${count > 3 ? '…' : ''}` : pairs.length ? pairs.join('，') : '工具结果'
          const time = controller.fmtTime(Number(m?.createdAt || 0))
          const label = isAsyncToolResult ? '异步工具返回' : '工具返回'
          const contextRole: MessageRole = isAsyncToolResult ? 'assistant' : 'user'

          return (
            <Stack key={mid} direction="row" justifyContent="flex-start">
              <Paper
                variant="outlined"
                data-mid={mid}
                onContextMenu={isEditing ? undefined : (e) => onMessageContextMenu(e, mid, contextRole)}
                sx={{
                  width: '100%',
                  maxWidth: '100%',
                  px: 1.25,
                  py: 1.1,
                  bgcolor: '#fff',
                  borderColor: 'rgba(15, 23, 42, .10)',
                  boxShadow: '0 8px 22px rgba(15,23,42,.05)',
                }}
              >
                <Stack
                  direction="row"
                  alignItems="center"
                  spacing={1}
                  role={isEditing ? undefined : 'button'}
                  tabIndex={isEditing ? -1 : 0}
                  aria-label={isEditing ? `${label}（编辑中）` : isToolExpanded ? `收起${label}` : `展开${label}`}
                  aria-expanded={isEditing ? undefined : isToolExpanded}
                  onClick={isEditing ? undefined : () => onToggleToolMessage(mid)}
                  onKeyDown={
                    isEditing
                      ? undefined
                      : (e) => {
                          const k = String((e as any)?.key || '')
                          if (k === 'Enter' || k === ' ') {
                            e.preventDefault()
                            onToggleToolMessage(mid)
                          }
                        }
                  }
                  sx={{ mb: 0.5, cursor: isEditing ? 'default' : 'pointer', userSelect: 'none' }}
                >
                  <StorageIcon sx={{ fontSize: 18, color: 'rgba(15, 23, 42, .62)' }} />
                  <Typography variant="body2" sx={{ fontWeight: 900 }}>
                    {label}
                  </Typography>
                  {summary ? (
                    <Typography variant="caption" color="text.secondary" sx={{ minWidth: 0 }} noWrap>
                      {summary}
                    </Typography>
                  ) : null}
                  <Box sx={{ flex: 1 }} />
                  <Box sx={{ display: 'flex', alignItems: 'center', color: 'text.secondary' }}>
                    {isToolExpanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                  </Box>
                  <Typography variant="caption" color="text.secondary">
                    {time}
                  </Typography>
                </Stack>

                {isEditing ? (
                  <Box sx={{ mt: 0.75 }}>
                    <TextField
                      autoFocus
                      fullWidth
                      multiline
                      minRows={3}
                      size="small"
                      placeholder={`编辑${label}…`}
                      value={editingMsg.text}
                      onChange={(e) => onEditTextChange(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') onCancelEditMessage()
                        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) onSaveEditMessage()
                      }}
                      sx={{ '& .MuiOutlinedInput-root': { bgcolor: '#fff' } }}
                    />
                    <Stack direction="row" spacing={1} sx={{ mt: 1 }} justifyContent="flex-end">
                      <Button size="small" variant="contained" onClick={onSaveEditMessage} disabled={!editingMsg.mid || messageMutationBlocked(editingMsg.mid, 'edit')}>
                        保存
                      </Button>
                      <Button size="small" onClick={onCancelEditMessage} disabled={loading || uiBusy}>
                        取消
                      </Button>
                    </Stack>
                  </Box>
                ) : (
                  <Collapse in={isToolExpanded} timeout={160} unmountOnExit>
                    <Box
                      sx={{
                        mt: 0.75,
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                        fontSize: 12,
                        whiteSpace: 'pre-wrap',
                        overflowWrap: 'anywhere',
                        wordBreak: 'break-word',
                        bgcolor: '#fff',
                        border: '1px solid rgba(15, 23, 42, .10)',
                        borderRadius: 2,
                        px: 1,
                        py: 0.75,
                      }}
                    >
                      {content}
                    </Box>
                  </Collapse>
                )}
              </Paper>
            </Stack>
          )
        }

        const displayRole: MessageRole = chatMessageMaterialKind(m) === 'user' ? 'user' : 'assistant'
        const isUser = displayRole === 'user'
        const speakerRoleId = !isUser ? String((m as any)?.speakerRoleId || '') : ''
        const speakerRole =
          !isUser && activeTargetKind === 'group'
            ? roles.find((r0: any) => String(r0?.id || '') === speakerRoleId) || null
            : !isUser
              ? activeRole
              : null
        const roleName = String((speakerRole as any)?.name || (activeTargetKind === 'group' ? 'AI' : activeRole?.name || 'AI'))
        const roleAvatarEmoji = String((speakerRole as any)?.avatar || '🤖')
        const roleAvatarImage = String((speakerRole as any)?.avatarImage || '')
        const roleModelText = !isUser ? formatModelRefText((m as any)?.modelRef) : ''
        const time = controller.fmtTime(Number(m?.createdAt || 0))
        const imgPaths = isUser ? (Array.isArray(m?.images) ? m.images : []) : []
        const rootAttachments = isUser && Array.isArray(m?.attachments) ? m.attachments : []
        const legacyAttMsgs = isUser ? groupedAttMsgsByRootMid.get(String(m?.id || '').trim()) || [] : []
        const fileAttachmentItems = [
          ...rootAttachments.map((a: any, idx: number) => ({ mid, idx, attachment: a })),
          ...legacyAttMsgs.map((am: any) => ({ mid: String(am?.id || '').trim(), idx: 0, attachment: am && Array.isArray(am.attachments) ? am.attachments[0] : null })),
        ].filter((item: any) => item.mid && item.attachment)
        const activeRunCard = activeRunCardForAssistantMessage(activeVisibleRunCards, m)
        const messageGenerating = !!activeRunCard && isAssistantGenerating(m)
        const messageAwaitingFirstOutput = messageGenerating && isAssistantAwaitingFirstOutput(m)
        const retryLabel = runRetryLabel(activeRunCard?.retry)
        const retryFailure = runRetryFailure(activeRunCard?.retry)
        const messageError = !isUser && (m as any)?.error && typeof (m as any).error === 'object' ? (m as any).error : null
        const assistantParts = Array.isArray((m as any)?.parts) ? (m as any).parts : []
        const hasReasoningParts = assistantParts.some((part: any) => String(part?.type || '').trim() === 'reasoning' && !!String(part?.text || '').trim())
        const canEdit = !isDisplayOnlyPendingRunTail && !isEditing && !!mid && !messageMutationBlocked(mid, 'edit')
        const canDeleteMessage = !isDisplayOnlyPendingRunTail && !!mid && !messageMutationBlocked(mid, 'delete')
        const contentLines = userMessageCollapseEnabled && isUser ? content.split(/\r?\n/) : []
        const canCollapse = userMessageCollapseEnabled && isUser && !isEditing && contentLines.length > userMessageCollapseLines
        const isExpanded = !canCollapse || expandedUserMsgIds.has(mid)
        const shownContent = canCollapse && !isExpanded ? contentLines.slice(0, userMessageCollapseLines).join('\n') : content

        let regenRole: MessageRole = isUser ? 'user' : 'assistant'
        let regenMid = isDisplayOnlyPendingRunTail ? '' : mid
        let regenBlocked = isUser || !regenMid ? false : messageMutationBlocked(regenMid, 'edit')
        if (isUser && !isDisplayOnlyPendingRunTail) {
          const msgs = chatAllMessagesRaw
          const fullIdx = msgs.findIndex((x: any) => String(x?.id || '') === mid)
          for (let j = fullIdx + 1; j < msgs.length; j++) {
            const next = msgs[j]
            if (!next) continue
            if (next.role === 'assistant') {
              regenRole = 'assistant'
              regenMid = String(next?.id || '')
              regenBlocked = messageMutationBlocked(regenMid, 'edit')
              break
            }
            if (next.role === 'user') break
          }
        } else if (!isDisplayOnlyPendingRunTail) {
          regenRole = 'assistant'
          regenMid = mid
          regenBlocked = messageMutationBlocked(regenMid, 'edit')
        }

        const branchPrevAiMid = !isUser && !isDisplayOnlyPendingRunTail ? String(prevAiMidByAssistantId.get(mid) || '').trim() : ''
        const branchSiblings = !isUser && branchPrevAiMid ? assistantSiblingsByPrevAiMid.get(branchPrevAiMid) || [] : []
        const branchIndex = !isUser ? branchSiblings.findIndex((x: any) => String(x?.id || '') === mid) : -1
        const canSwitchBranch = !isUser && branchSiblings.length >= 2 && branchIndex >= 0

        return (
          <Stack key={mid} direction="row" justifyContent={isUser ? 'flex-end' : 'flex-start'}>
            <Paper
              elevation={0}
              data-mid={mid}
              onContextMenu={isEditing || isDisplayOnlyPendingRunTail ? undefined : (e) => onMessageContextMenu(e, mid, isUser ? 'user' : 'assistant')}
              sx={{
                width: isUser ? 'auto' : '100%',
                maxWidth: isUser ? 920 : '100%',
                px: 1.5,
                py: 1.25,
                bgcolor: isUser ? '#fff' : 'transparent',
                backgroundImage: 'none',
                boxShadow: 'none',
              }}
            >
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.75 }}>
                {isUser ? null : (
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                    <Avatar src={roleAvatarImage || undefined} sx={{ width: 66, height: 66, fontSize: 28 }}>
                      {roleAvatarEmoji}
                    </Avatar>
                    <Stack spacing={0} sx={{ minWidth: 0 }}>
                      <Typography variant="subtitle1" sx={{ fontWeight: 900, minWidth: 0, fontSize: 20 }} noWrap>
                        {roleName}
                      </Typography>
                      {roleModelText ? (
                        <Typography variant="caption" color="text.secondary" sx={{ minWidth: 0, lineHeight: 1.2 }} noWrap>
                          {roleModelText}
                        </Typography>
                      ) : null}
                    </Stack>
                  </Stack>
                )}
                <Box sx={{ flex: 1 }} />
                <Typography variant="caption" color="text.secondary">
                  {time}
                </Typography>
              </Stack>

              {imgPaths.length ? (
                <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: 'wrap' }}>
                  {imgPaths.slice(0, 8).map((p: string) => (
                    <RefImageThumb key={p} controller={controller} path={String(p || '')} />
                  ))}
                </Stack>
              ) : null}

              {isEditing ? (
                <TextField
                  autoFocus
                  fullWidth
                  multiline
                  minRows={3}
                  size="small"
                  placeholder={isUser ? '编辑用户消息…' : '编辑 AI 回复…'}
                  value={editingMsg.text}
                  onChange={(e) => onEditTextChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') onCancelEditMessage()
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) onSaveEditMessage()
                  }}
                  sx={{ '& .MuiOutlinedInput-root': { bgcolor: '#fff' } }}
                />
              ) : isUser ? (
                <Box>
                  {shownContent ? (
                    stickersEnabled ? (
                      <StickerText controller={controller} text={shownContent} stickerMap={stickerMap} />
                    ) : (
                      <Typography sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{shownContent}</Typography>
                    )
                  ) : fileAttachmentItems.length ? (
                    <Typography variant="body2" color="text.secondary">
                      （附件）
                    </Typography>
                  ) : null}
                  {canCollapse ? (
                    <Box sx={{ textAlign: 'right' }}>
                      <Button
                        size="small"
                        variant="text"
                        onClick={() => onToggleUserMessage(mid)}
                        aria-label={isExpanded ? '收起用户消息' : '展开用户消息'}
                        aria-expanded={isExpanded}
                        sx={{ mt: 0.25, minWidth: 0, px: 0.5, borderRadius: 2 }}
                      >
                        {isExpanded ? `收起（共${contentLines.length}行）` : `展开（共${contentLines.length}行）`}
                      </Button>
                    </Box>
                  ) : null}
                  {fileAttachmentItems.length ? (
                    <Stack direction="row" spacing={0.75} sx={{ mt: 0.75, flexWrap: 'wrap' }}>
                      {fileAttachmentItems.slice(0, 20).map((item: any) => {
                        const a = item.attachment
                        const targetMid = String(item.mid || '').trim()
                        if (!a || !targetMid) return null
                        const name = String(a?.name || '文件')
                        const pct = clampNum(Math.round(Number(a?.sendPct ?? 100)), 0, 100)
                        const fullLen = clampNum(Math.round(Number(a?.fullLen ?? 0)), 0, 10_000_000)
                        const sendLen = clampNum(Math.round(Number(a?.sendLen ?? String(a?.text || '').length ?? 0)), 0, fullLen || 0)
                        const label = `${name}（${pct}%：${sendLen}/${fullLen}）`
                        return (
                          <Chip
                            key={`${targetMid}:${String(a?.id || item.idx || 0)}`}
                            size="small"
                            icon={<AttachFileIcon fontSize="small" />}
                            label={label}
                            variant="outlined"
                            onClick={(e) => onOpenAttachView(e as any, targetMid, Number(item.idx || 0))}
                            sx={{ maxWidth: 520 }}
                          />
                        )
                      })}
                    </Stack>
                  ) : null}
                </Box>
              ) : messageError || retryFailure ? (
                <Stack spacing={1}>
                  {messageError ? <AssistantErrorNotice error={messageError} /> : null}
                  {retryFailure ? <AssistantErrorNotice error={retryFailure} title="本次请求失败" /> : null}
                  {content || assistantParts.length ? (
                    <AssistantMessageBlocks
                      controller={controller}
                      text={content}
                      parts={assistantParts}
                      mid={mid}
                      isGenerating={messageGenerating}
                      renderSafetyPolicyKey={renderSafetyPolicyKey}
                      chatRootRef={chatRootRef}
                      disabled={!canEdit}
                    />
                  ) : null}
                </Stack>
              ) : messageAwaitingFirstOutput && !hasReasoningParts ? (
                <AssistantReplyPendingIndicator />
              ) : (
                <Stack spacing={1}>
                  <AssistantMessageBlocks
                    controller={controller}
                    text={content}
                    parts={assistantParts}
                    mid={mid}
                    isGenerating={messageGenerating}
                    renderSafetyPolicyKey={renderSafetyPolicyKey}
                    chatRootRef={chatRootRef}
                    disabled={!canEdit}
                  />
                  {messageAwaitingFirstOutput ? <AssistantReplyPendingIndicator /> : null}
                </Stack>
              )}

              {isDisplayOnlyPendingRunTail ? null : isEditing ? (
                <Stack direction="row" spacing={1} sx={{ mt: 1 }} justifyContent="flex-end">
                  <Button size="small" variant="contained" onClick={onSaveEditMessage} disabled={!editingMsg.mid || messageMutationBlocked(editingMsg.mid, 'edit')}>
                    保存
                  </Button>
                  <Button size="small" onClick={onCancelEditMessage} disabled={loading || uiBusy}>
                    取消
                  </Button>
                </Stack>
              ) : (
                <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }} justifyContent="flex-end">
                  {!isUser ? (
                    <>
                      <Tooltip title="上一个分支">
                        <span>
                          <IconButton
                            aria-label="上一个分支"
                            size="small"
                            disabled={!canSwitchBranch || loading || uiBusy}
                            onClick={() => {
                              if (!canSwitchBranch) return
                              const len = branchSiblings.length
                              if (!len) return
                              const next = branchSiblings[(branchIndex - 1 + len) % len]
                              const nextMid = String(next?.id || '').trim()
                              onSwitchBranchSibling(mid, -1, nextMid)
                            }}
                          >
                            <ChevronLeftIcon fontSize="inherit" />
                          </IconButton>
                        </span>
                      </Tooltip>

                      <Tooltip title="下一个分支">
                        <span>
                          <IconButton
                            aria-label="下一个分支"
                            size="small"
                            disabled={!canSwitchBranch || loading || uiBusy}
                            onClick={() => {
                              if (!canSwitchBranch) return
                              const len = branchSiblings.length
                              if (!len) return
                              const next = branchSiblings[(branchIndex + 1) % len]
                              const nextMid = String(next?.id || '').trim()
                              onSwitchBranchSibling(mid, 1, nextMid)
                            }}
                          >
                            <ChevronRightIcon fontSize="inherit" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </>
                  ) : null}

                  <Tooltip title="重新回复">
                    <span>
                      <IconButton
                        aria-label="重新回复"
                        size="small"
                        disabled={!regenMid || loading || uiBusy || (regenRole === 'assistant' && regenBlocked)}
                        onClick={() => {
                          if (!regenMid) return
                          onRegenerate(regenMid, regenRole)
                        }}
                      >
                        <RestartAltIcon fontSize="inherit" />
                      </IconButton>
                    </span>
                  </Tooltip>

                  {!isUser ? (
                    <>
                      <Tooltip title="编辑">
                        <span>
                          <IconButton aria-label="编辑消息" size="small" disabled={!canEdit} onClick={() => onStartEditMessage(mid, content)}>
                            <EditOutlinedIcon fontSize="inherit" />
                          </IconButton>
                        </span>
                      </Tooltip>

                      <Tooltip title="复制">
                        <IconButton aria-label="复制内容" size="small" disabled={!mid} onClick={() => onCopyMessageText(content)}>
                          <ContentCopyIcon fontSize="inherit" />
                        </IconButton>
                      </Tooltip>

                      <Tooltip title="删除">
                        <span>
                          <IconButton aria-label="删除消息" size="small" disabled={!canDeleteMessage} onClick={() => onDeleteMessage(mid, displayRole)}>
                            <DeleteOutlineIcon fontSize="inherit" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </>
                  ) : null}

                  {isUser ? (
                    <>
                      <Tooltip title="编辑">
                        <span>
                          <IconButton aria-label="编辑消息" size="small" disabled={!canEdit} onClick={() => onStartEditMessage(mid, content)}>
                            <EditOutlinedIcon fontSize="inherit" />
                          </IconButton>
                        </span>
                      </Tooltip>

                      <Tooltip title="复制">
                        <IconButton aria-label="复制内容" size="small" onClick={() => onCopyMessageText(content)}>
                          <ContentCopyIcon fontSize="inherit" />
                        </IconButton>
                      </Tooltip>
                    </>
                  ) : null}
                </Stack>
              )}

              {messageGenerating ? (
                <Box sx={{ mt: 1 }}>
                  <Chip size="small" color={retryLabel ? 'warning' : 'default'} label={retryLabel || (m?.streaming ? '生成中（流式）' : '生成中')} />
                </Box>
              ) : null}
            </Paper>
          </Stack>
        )
      })}
    </Stack>
  )
})
