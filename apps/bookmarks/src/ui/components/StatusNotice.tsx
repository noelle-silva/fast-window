import * as React from 'react'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import { Alert, Button, CircularProgress, Stack, Typography } from '@mui/material'
import type { DataDirStatus, Phase } from '../types'

type Props = {
  busy: boolean
  error: string | null
  phase: Phase
  status: DataDirStatus | null
  onPickDataDir(): void
  onRestart(): void
}

export function StatusNotice(props: Props): React.ReactNode {
  if (props.phase === 'starting') {
    return <Alert severity="info" icon={<CircularProgress size={18} />} sx={{ mx: { xs: 1.5, sm: 2 }, mb: 1 }}>正在连接网站收藏后台...</Alert>
  }
  if (props.phase !== 'failed') return null
  return (
    <Alert
      severity="error"
      icon={<WarningAmberRoundedIcon />}
      sx={{ mx: { xs: 1.5, sm: 2 }, mb: 1, alignItems: 'flex-start' }}
      action={
        <Stack direction="row" spacing={1}>
          <Button color="inherit" size="small" onClick={props.onRestart} disabled={props.busy}>重试</Button>
          <Button color="inherit" size="small" onClick={props.onPickDataDir} disabled={props.busy}>数据目录</Button>
        </Stack>
      }
    >
      <Typography fontWeight={900}>后台或数据目录暂不可用</Typography>
      <Typography variant="body2">{props.error || props.status?.error || '请重试或选择新的数据目录。'}</Typography>
    </Alert>
  )
}
