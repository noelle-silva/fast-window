import * as React from 'react'
import { Box, CircularProgress, Typography } from '@mui/material'
import { useLiveNowMs } from '../hooks/useLiveNowMs'
import { formatFirstTokenWaitMs } from '../utils/time'

// AssistantReplyPendingIndicator 是「即将输出回答」的占位：
// 首个增量到达前，spinner 旁挂一枚首字秒表，按客户端发起的时刻实时递增。
export function AssistantReplyPendingIndicator(props: { startedAtMs?: number }) {
  const startedAtMs = Math.max(0, Math.floor(Number(props.startedAtMs || 0)))
  const liveNowMs = useLiveNowMs(startedAtMs > 0)
  const waitText = startedAtMs > 0 ? formatFirstTokenWaitMs(Math.max(0, liveNowMs - startedAtMs)) : ''
  return (
    <Box
      role="status"
      aria-live="polite"
      aria-label="AI 回复加载中"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 0.75,
        minWidth: 66,
        minHeight: 32,
        color: 'text.secondary',
        flexShrink: 0,
      }}
    >
      <CircularProgress size={20} thickness={4.4} color="inherit" />
      {waitText ? (
        <Typography variant="caption" aria-hidden="true" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
          {waitText}
        </Typography>
      ) : null}
    </Box>
  )
}
