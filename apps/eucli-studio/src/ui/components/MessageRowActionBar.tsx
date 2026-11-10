import * as React from 'react'
import { IconButton, Stack, Tooltip, Typography } from '@mui/material'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import RestartAltIcon from '@mui/icons-material/RestartAlt'

export type MessageRowActionRole = 'user' | 'assistant'

export type MessageRowActionHandlers = {
  onSwitchBranchSibling: (mid: string, direction: -1 | 1, nextMid: string) => void
  onRegenerate: (mid: string, role: MessageRowActionRole) => void
  onStartEditMessage: (mid: string, text: string) => void
  onCopyMessageText: (text: unknown) => void
  onDeleteMessage: (mid: string, role: MessageRowActionRole) => void
}

// 与 MUI size="small" IconButton 的实际高度一致：操作栏常驻并锁定高度，
// 按钮挂载/卸载不会改变消息行高度，避免滚动位置跳动。
export const MESSAGE_ROW_ACTION_BAR_HEIGHT = 28

export type MessageRowActionBarProps = {
  revealed: boolean
  metaText: string
  isUser: boolean
  loading: boolean
  uiBusy: boolean
  mid: string
  // 动作期取文本：流式推进不会重渲染消息行，渲染期快照会过期。
  // 编辑 / 复制在点击时向消息事实源要最新值，而不是复用某一帧的产物。
  readContent: () => string
  displayRole: MessageRowActionRole
  canEdit: boolean
  canDeleteMessage: boolean
  canSwitchBranch: boolean
  branchSiblings: any[]
  branchIndex: number
  regenMid: string
  regenRole: MessageRowActionRole
  regenBlocked: boolean
  handlers: MessageRowActionHandlers
}

export const MessageRowActionBar = React.memo(function MessageRowActionBar(props: MessageRowActionBarProps) {
  const {
    revealed,
    metaText,
    isUser,
    loading,
    uiBusy,
    mid,
    readContent,
    displayRole,
    canEdit,
    canDeleteMessage,
    canSwitchBranch,
    branchSiblings,
    branchIndex,
    regenMid,
    regenRole,
    regenBlocked,
    handlers,
  } = props
  const { onSwitchBranchSibling, onRegenerate, onStartEditMessage, onCopyMessageText, onDeleteMessage } = handlers

  return (
    <Stack
      direction="row"
      spacing={0.5}
      justifyContent="flex-end"
      alignItems="center"
      data-fw-message-actions={revealed ? 'revealed' : 'hidden'}
      style={{ height: MESSAGE_ROW_ACTION_BAR_HEIGHT }}
      sx={{ mt: 0.5 }}
    >
      {metaText ? (
        <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', mr: 0.25 }}>
          {metaText}
        </Typography>
      ) : null}
      {revealed ? (
        <>
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
                  <IconButton aria-label="编辑消息" size="small" disabled={!canEdit} onClick={() => onStartEditMessage(mid, readContent())}>
                    <EditOutlinedIcon fontSize="inherit" />
                  </IconButton>
                </span>
              </Tooltip>

              <Tooltip title="复制">
                <IconButton aria-label="复制内容" size="small" disabled={!mid} onClick={() => onCopyMessageText(readContent())}>
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
                  <IconButton aria-label="编辑消息" size="small" disabled={!canEdit} onClick={() => onStartEditMessage(mid, readContent())}>
                    <EditOutlinedIcon fontSize="inherit" />
                  </IconButton>
                </span>
              </Tooltip>

              <Tooltip title="复制">
                <IconButton aria-label="复制内容" size="small" onClick={() => onCopyMessageText(readContent())}>
                  <ContentCopyIcon fontSize="inherit" />
                </IconButton>
              </Tooltip>
            </>
          ) : null}
        </>
      ) : null}
    </Stack>
  )
})
