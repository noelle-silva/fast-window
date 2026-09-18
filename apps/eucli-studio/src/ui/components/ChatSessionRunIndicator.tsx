import * as React from 'react'
import { Box, CircularProgress, Tooltip } from '@mui/material'
import type { ChatSessionRunStatus } from '../../domain/chatSessionRunStatus'

export type ChatSessionRunIndicatorKind = Exclude<ChatSessionRunStatus, 'idle'>

const INDICATOR_LABEL: Record<ChatSessionRunIndicatorKind, string> = {
  running: '会话正在运行',
  completed: '会话已完成，打开后标记为已读',
  interrupted: '会话异常中断，打开后标记为已读',
}

const DOT_COLOR: Record<Exclude<ChatSessionRunIndicatorKind, 'running'>, string> = {
  completed: 'success.main',
  interrupted: 'error.main',
}

export function ChatSessionRunIndicator(props: { kind: ChatSessionRunIndicatorKind }) {
  const { kind } = props
  const label = INDICATOR_LABEL[kind]

  return (
    <Tooltip title={label}>
      <Box
        component="span"
        role="status"
        aria-label={label}
        sx={{
          width: 18,
          height: 18,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flex: '0 0 18px',
        }}
      >
        {kind === 'running' ? (
          <CircularProgress size={14} thickness={5} color="inherit" sx={{ color: 'primary.main' }} />
        ) : (
          <Box
            component="span"
            sx={{
              width: 8,
              height: 8,
              borderRadius: 999,
              bgcolor: DOT_COLOR[kind],
              boxShadow: (theme) => `0 0 0 3px ${theme.palette[kind === 'completed' ? 'success' : 'error'].main}1f`,
            }}
          />
        )}
      </Box>
    </Tooltip>
  )
}
