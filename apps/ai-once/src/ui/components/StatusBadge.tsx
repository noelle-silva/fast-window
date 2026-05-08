import { Chip } from '@mui/material'
import type { AiOncePhase } from '../state'

type StatusBadgeProps = {
  phase: AiOncePhase
}

export function StatusBadge(props: StatusBadgeProps) {
  if (props.phase === 'ready') return <Chip size="small" color="success" label="就绪" />
  if (props.phase === 'failed') return <Chip size="small" color="error" label="需设置" />
  return <Chip size="small" color="warning" label="启动中" />
}
