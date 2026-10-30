import * as React from 'react'
import { Box, Button, Chip, Collapse, IconButton, Paper, Stack, TextField, Tooltip, Typography } from '@mui/material'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import StorageIcon from '@mui/icons-material/Storage'
import { EntityAvatar } from './avatar/EntityAvatar'
import { isAssistantGenerating } from '../../domain/assistantRunState'
import { messageVisibleText } from '../../domain/chatMessageDisplay'
import { chatMessageMaterialKind, isAsyncToolResultMessage, isCompressionSummaryMessage, isSystemControlMessage } from '../../domain/message'
import { resolveReplyDurationMs } from '../../domain/messageTiming'
import type { MessageMutationOperation } from '../../domain/messageMutationConflicts'
import type { ReasoningDisplayMode } from '../../domain/reasoningDisplay'
import { AssistantErrorNotice } from './AssistantErrorNotice'
import { LiveAssistantBody } from './LiveAssistantBody'
import { RefImageThumb, StickerText } from './MessageMedia'
import { formatDurationMs } from '../utils/time'

type MessageRole = 'user' | 'assistant'

// uiPolicy 是「影响整列显示口径」的稳定集合：设置、字体、角色、推理展示等。
// 它是单例对象（App 侧 useMemo），所以行级比较只需 `===`，不做任何深比较。
export type MessageRowUiPolicy = {
  activeTargetKind: 'role' | 'group' | 'workspace'
  roles: any[]
  activeRole: any
  loading: boolean
  uiBusy: boolean
  userMessageCollapseEnabled: boolean
  userMessageCollapseLines: number
  reasoningDisplayMode: ReasoningDisplayMode
  reasoningRenderEnabled: boolean
  stickersEnabled: boolean
  stickerMap: any
  renderSafetyPolicyKey: string
  formatModelRefText: (modelRef: any) => string
}

// actions 是 controller 生命周期内的单例 handler 集合：身份稳定，行级比较只需 `===`。
export type MessageRowActions = {
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

export type MessageRowProps = {
  controller: any
  mid: string
  message: any
  // runCard 由列表侧预建的 runCardByMid 直接给出，行内不再线性扫描。
  runCard: any
  // branchSiblings 由列表侧预建的分支索引给出，行内不再查表。
  branchSiblings: any[]
  // branchIndex 由列表侧预建：行内不再 findIndex。
  branchIndex: number
  // 用户消息重新回复的目标：列表侧 O(n) 预建，行内 O(1) 读取。
  nextAssistantMid: string
  isUserExpanded: boolean
  isToolExpanded: boolean
  isEditing: boolean
  editingText: string
  uiPolicy: MessageRowUiPolicy
  actions: MessageRowActions
  chatRootRef: React.RefObject<HTMLElement | null>
  // 消息级缓存代际（会话身份）：同一页内稳定，切换页面才变化。
  cacheScope: string
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

function MessageRowImpl(props: MessageRowProps) {
  const {
    controller,
    mid,
    message: m,
    runCard,
    branchSiblings,
    branchIndex,
    nextAssistantMid,
    isUserExpanded,
    isToolExpanded,
    isEditing,
    editingText,
    uiPolicy,
    actions,
    chatRootRef,
    cacheScope,
  } = props
  const {
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
  } = uiPolicy
  const {
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
  } = actions

  const content = messageVisibleText(m)
  const isAsyncToolResult = isAsyncToolResultMessage(m)
  const isToolResponse = isAsyncToolResult || content.startsWith('<<<[TOOL_RESPONSE]>>>')
  const isDisplayOnlyPendingRunTail = !!(m as any)?.displayOnlyPendingRunTail

  if (isSystemControlMessage(m)) {
    const isSummary = isCompressionSummaryMessage(m)
    const time = controller.fmtTime(Number(m?.createdAt || 0))
    const retain = Math.max(0, Math.floor(Number(m?.control?.retainRecentMessages || 0)))
    const version = Math.max(0, Math.floor(Number(m?.control?.summaryVersion || 0)))
    return (
      <Stack direction="row" justifyContent="center">
        <Paper
          variant="outlined"
          data-mid={mid}
          sx={{
            width: '100%',
            maxWidth: 980,
            px: 1.5,
            py: 1.2,
            bgcolor: isSummary ? 'var(--studio-secondary-soft)' : 'var(--studio-paper-muted)',
            borderColor: isSummary ? 'var(--studio-secondary)' : 'var(--studio-border)',
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
                bgcolor: 'var(--studio-paper)',
                border: '1px solid var(--studio-border)',
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
      <Stack direction="row" justifyContent="flex-start">
        <Paper
          variant="outlined"
          data-mid={mid}
          onContextMenu={isEditing ? undefined : (e) => onMessageContextMenu(e, mid, contextRole)}
          sx={{
            width: '100%',
            maxWidth: '100%',
            px: 1.25,
            py: 1.1,
            bgcolor: 'var(--studio-paper)',
            borderColor: 'var(--studio-border)',
            boxShadow: 'var(--studio-shadow-soft)',
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
            <StorageIcon sx={{ fontSize: 18, color: 'var(--studio-text-secondary)' }} />
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
                value={editingText}
                onChange={(e) => onEditTextChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') onCancelEditMessage()
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) onSaveEditMessage()
                }}
                sx={{ '& .MuiOutlinedInput-root': { bgcolor: '#fff' } }}
              />
              <Stack direction="row" spacing={1} sx={{ mt: 1 }} justifyContent="flex-end">
                <Button size="small" variant="contained" onClick={onSaveEditMessage} disabled={!mid || messageMutationBlocked(mid, 'edit')}>
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
                  bgcolor: 'var(--studio-paper)',
                  border: '1px solid var(--studio-border)',
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
  // 头像与名字用于区分发言人，只有群聊存在多个发言人时才需要显示
  const showSpeakerIdentity = activeTargetKind === 'group'
  const roleAvatarImage = String((speakerRole as any)?.avatarImage || '')
  const roleModelText = !isUser ? formatModelRefText((m as any)?.modelRef) : ''
  const replyDurationText = !isUser ? formatDurationMs(resolveReplyDurationMs(m)) : ''
  const time = controller.fmtTime(Number(m?.createdAt || 0))
  // 耗时与时间移到操作按钮左侧：AI 消息显示「回复耗时 · 时间」，用户消息只显示时间。
  const actionMetaText = (isUser ? [time] : [replyDurationText, time]).filter(Boolean).join(' · ')
  const imgPaths = isUser ? (Array.isArray(m?.images) ? m.images : []) : []
  // toolImgPaths 是工具产物图：独立于工具卡片的附件块。
  const toolImgPaths = !isUser ? (Array.isArray((m as any)?.toolImages) ? (m as any).toolImages : []) : []
  const messageGenerating = !!runCard && isAssistantGenerating(m)
  const retryLabel = runRetryLabel(runCard?.retry)
  const retryFailure = runRetryFailure(runCard?.retry)
  const messageError = !isUser && (m as any)?.error && typeof (m as any).error === 'object' ? (m as any).error : null
  const canEdit = !isDisplayOnlyPendingRunTail && !isEditing && !!mid && !messageMutationBlocked(mid, 'edit')
  const canDeleteMessage = !isDisplayOnlyPendingRunTail && !!mid && !messageMutationBlocked(mid, 'delete')
  const contentLines = userMessageCollapseEnabled && isUser ? content.split(/\r?\n/) : []
  const canCollapse = userMessageCollapseEnabled && isUser && !isEditing && contentLines.length > userMessageCollapseLines
  const isExpanded = !canCollapse || isUserExpanded
  const shownContent = canCollapse && !isExpanded ? contentLines.slice(0, userMessageCollapseLines).join('\n') : content

  let regenRole: MessageRole = isUser ? 'user' : 'assistant'
  let regenMid = isDisplayOnlyPendingRunTail ? '' : mid
  let regenBlocked = isUser || !regenMid ? false : messageMutationBlocked(regenMid, 'edit')
  if (isUser && !isDisplayOnlyPendingRunTail) {
    // 用户消息的重新回复目标是列表侧 O(n) 预建的下一条 AI 消息，行内不再 findIndex。
    // 没有下一条 AI 时保持原语义：以这条用户消息本身为落点重新发起。
    if (nextAssistantMid) {
      regenRole = 'assistant'
      regenMid = nextAssistantMid
      regenBlocked = messageMutationBlocked(regenMid, 'edit')
    }
  } else if (!isDisplayOnlyPendingRunTail) {
    regenRole = 'assistant'
    regenMid = mid
    regenBlocked = messageMutationBlocked(regenMid, 'edit')
  }

  const siblings = branchSiblings
  const canSwitchBranch = !isUser && siblings.length >= 2 && branchIndex >= 0

  return (
    <Stack direction="row" justifyContent={isUser ? 'flex-end' : 'flex-start'}>
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
        {!isUser && (showSpeakerIdentity || !!roleModelText) ? (
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.75 }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
              {showSpeakerIdentity ? <EntityAvatar kind="role" image={roleAvatarImage} size={66} /> : null}
              <Stack spacing={0} sx={{ minWidth: 0 }}>
                {showSpeakerIdentity ? (
                  <Typography variant="subtitle1" sx={{ fontWeight: 900, minWidth: 0, fontSize: 20 }} noWrap>
                    {roleName}
                  </Typography>
                ) : null}
                {roleModelText ? (
                  <Typography variant="caption" color="text.secondary" sx={{ minWidth: 0, lineHeight: 1.2 }} noWrap>
                    {roleModelText}
                  </Typography>
                ) : null}
              </Stack>
            </Stack>
          </Stack>
        ) : null}

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
            className="fw-chat-text"
            placeholder={isUser ? '编辑用户消息…' : '编辑 AI 回复…'}
            value={editingText}
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
                <Typography className="fw-chat-text" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{shownContent}</Typography>
              )
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
          </Box>
        ) : messageError || retryFailure ? (
          <Stack spacing={1}>
            {messageError ? <AssistantErrorNotice error={messageError} /> : null}
            {retryFailure ? <AssistantErrorNotice error={retryFailure} title="本次请求失败" /> : null}
            <LiveAssistantBody
              controller={controller}
              message={m}
              mid={mid}
              isGenerating={messageGenerating}
              reasoningDisplayMode={reasoningDisplayMode}
              reasoningRenderEnabled={reasoningRenderEnabled}
              renderSafetyPolicyKey={renderSafetyPolicyKey}
              chatRootRef={chatRootRef}
              disabled={!canEdit}
              cacheScope={cacheScope}
            />
          </Stack>
        ) : (
          // LiveAssistantBody 必须从首帧开始挂载：它同时负责订阅本条消息的范围刷新。
          // 即使当前还没有可见正文或思考文字，也不能用加载圈替换掉它，
          // 否则后续流式增量没有订阅者，只能等下一次全局刷新才出现。
          <Stack spacing={1}>
            <LiveAssistantBody
              controller={controller}
              message={m}
              mid={mid}
              isGenerating={messageGenerating}
              reasoningDisplayMode={reasoningDisplayMode}
              reasoningRenderEnabled={reasoningRenderEnabled}
              renderSafetyPolicyKey={renderSafetyPolicyKey}
              chatRootRef={chatRootRef}
              disabled={!canEdit}
              cacheScope={cacheScope}
            />
          </Stack>
        )}

        {toolImgPaths.length ? (
          <Stack spacing={0.75} sx={{ mt: 1 }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 800 }}>
              工具产物图片
            </Typography>
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
              {toolImgPaths.slice(0, 8).map((p: string) => (
                <RefImageThumb key={p} controller={controller} path={String(p || '')} />
              ))}
            </Stack>
          </Stack>
        ) : null}

        {isDisplayOnlyPendingRunTail ? null : isEditing ? (
          <Stack direction="row" spacing={1} sx={{ mt: 1 }} justifyContent="flex-end">
            <Button size="small" variant="contained" onClick={onSaveEditMessage} disabled={!mid || messageMutationBlocked(mid, 'edit')}>
              保存
            </Button>
            <Button size="small" onClick={onCancelEditMessage} disabled={loading || uiBusy}>
              取消
            </Button>
          </Stack>
        ) : (
          <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }} justifyContent="flex-end" alignItems="center">
            {actionMetaText ? (
              <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', mr: 0.25 }}>
                {actionMetaText}
              </Typography>
            ) : null}
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
                        const len = siblings.length
                        if (!len) return
                        const next = siblings[(branchIndex - 1 + len) % len]
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
                        const len = siblings.length
                        if (!len) return
                        const next = siblings[(branchIndex + 1) % len]
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
}

// 行级 memo：比较只看引用与布尔，O(1)，不做任何深比较。
// 已上屏的行在数据未变时不会因为父级重渲染而重建。
export const MessageRow = React.memo(MessageRowImpl, (prev, next) => (
  prev.controller === next.controller &&
  prev.mid === next.mid &&
  prev.message === next.message &&
  prev.runCard === next.runCard &&
  prev.branchSiblings === next.branchSiblings &&
  prev.branchIndex === next.branchIndex &&
  prev.nextAssistantMid === next.nextAssistantMid &&
  prev.isUserExpanded === next.isUserExpanded &&
  prev.isToolExpanded === next.isToolExpanded &&
  prev.isEditing === next.isEditing &&
  prev.editingText === next.editingText &&
  prev.uiPolicy === next.uiPolicy &&
  prev.actions === next.actions &&
  prev.chatRootRef === next.chatRootRef &&
  prev.cacheScope === next.cacheScope
))
