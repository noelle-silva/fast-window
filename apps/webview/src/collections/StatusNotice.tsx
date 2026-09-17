import * as React from 'react'
import { Alert, Button, CircularProgress, Stack, Typography } from '@mui/material'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import type { DataDirStatus, Phase } from './types'

export function StatusNotice(props: { busy: boolean; error: string | null; phase: Phase; status: DataDirStatus | null; onPickDataDir(): void; onRestart(): void }) {
  if (props.phase === 'starting') {
    return <Alert severity="info" icon={<CircularProgress size={18} />} sx={{ mx: { xs: 1.5, sm: 2 }, mb: 1 }}>正在加载收藏数据...</Alert>
  }
  if (props.phase === 'data-error') {
    return (
      <Alert
        severity="warning"
        icon={<WarningAmberRoundedIcon />}
        sx={{ mx: { xs: 1.5, sm: 2 }, mb: 1, alignItems: 'flex-start' }}
        action={
          <Stack direction="row" spacing={1}>
            <Button color="inherit" size="small" onClick={props.onPickDataDir} disabled={props.busy}>数据目录</Button>
          </Stack>
        }
      >
        <Typography fontWeight={900}>数据文件需要处理</Typography>
        <Typography variant="body2">{props.error || '当前数据无法升级到此版本。请检查数据目录，或选择其它数据目录。'}</Typography>
      </Alert>
    )
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
      <Typography fontWeight={900}>收藏数据不可用</Typography>
      <Typography variant="body2">{props.error || props.status?.error || '请重试或选择新的数据目录。'}</Typography>
    </Alert>
  )
}
