import * as React from 'react'
import { Box } from '@mui/material'
import CheckIcon from '@mui/icons-material/Check'
import CloseIcon from '@mui/icons-material/Close'
import PauseIcon from '@mui/icons-material/Pause'
import { toolCallPhase, type ToolCallPhase } from '../../domain/toolCallState'

// 状态圆：淡色底 + 同色系深一档的符号，没有描边，也不给整块区域铺亮色。
const PHASE_VISUAL: Record<ToolCallPhase, { bgcolor: string; color: string; label: string }> = {
  success: { bgcolor: 'var(--studio-success-bg)', color: 'var(--studio-success-text)', label: '工具调用成功' },
  error: { bgcolor: 'var(--studio-danger-bg)', color: 'var(--studio-danger-text)', label: '工具调用失败' },
  pending: { bgcolor: 'var(--studio-warning-bg)', color: 'var(--studio-warning-text)', label: '工具调用等待确认' },
  running: { bgcolor: 'var(--studio-divider)', color: 'var(--studio-text-secondary)', label: '工具调用进行中' },
}

export function ToolCallStatusDot(props: { part: any }) {
  const phase = toolCallPhase(props.part)
  const visual = PHASE_VISUAL[phase]

  return (
    <Box
      role="img"
      aria-label={visual.label}
      data-tool-phase={phase}
      sx={{
        width: 20,
        height: 20,
        flexShrink: 0,
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: visual.bgcolor,
        color: visual.color,
      }}
    >
      {phase === 'success' ? <CheckIcon sx={{ fontSize: 14 }} /> : null}
      {phase === 'error' ? <CloseIcon sx={{ fontSize: 14 }} /> : null}
      {phase === 'pending' ? <PauseIcon sx={{ fontSize: 13 }} /> : null}
      {phase === 'running' ? <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'currentColor' }} /> : null}
    </Box>
  )
}
