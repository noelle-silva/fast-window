import { Box, Tooltip } from '@mui/material'

export type ProcessBadgeTone = 'running' | 'ended'

type ProcessBadgeProps = {
  tone: ProcessBadgeTone
  count: number
  className?: string
}

const TONE_LABEL: Record<ProcessBadgeTone, string> = {
  running: '正在运行',
  ended: '已结束',
}

export function ProcessBadge({ tone, count, className }: ProcessBadgeProps) {
  if (count <= 0) return null
  const label = `${count} 个进程${TONE_LABEL[tone]}`
  return (
    <Tooltip title={label}>
      <Box
        component="span"
        className={`cr-process-badge cr-process-badge-${tone}${className ? ` ${className}` : ''}`}
        role="status"
        aria-label={label}
      >
        <Box component="span" className="cr-process-badge-dot" aria-hidden="true" />
        <Box component="span" className="cr-process-badge-count">{count}</Box>
      </Box>
    </Tooltip>
  )
}
