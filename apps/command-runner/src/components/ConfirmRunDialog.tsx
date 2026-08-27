import * as React from 'react'
import { Alert, Box, Button, Typography } from '@mui/material'
import { DialogShell } from './DialogShell'
import { closeModeLabel, resolveCloseMode, resolveCountdownSeconds, resolveShellInfo } from '../shellResolve'
import type { AppSettings, CommandItem, Repo, ShellInfo } from '../types'

type ConfirmRunDialogProps = {
  command: CommandItem
  repo: Repo
  settings: AppSettings | null
  shells: ShellInfo[]
  disabled?: boolean
  onConfirm: () => Promise<void> | void
  onClose: () => void
}

export function ConfirmRunDialog({ command, repo, settings, shells, disabled = false, onConfirm, onClose }: ConfirmRunDialogProps) {
  const shell = resolveShellInfo(command.shellId, repo.shellId, settings, shells)
  const closeMode = resolveCloseMode(command, settings)
  const countdownSeconds = resolveCountdownSeconds(command, settings)
  const [error, setError] = React.useState<string | null>(null)
  const [running, setRunning] = React.useState(false)

  const confirm = React.useCallback(async () => {
    if (running) return
    setRunning(true)
    setError(null)
    try {
      await onConfirm()
    } catch (e) {
      setError(String((e as { message?: string })?.message || e || '运行命令失败'))
      setRunning(false)
    }
  }, [onConfirm, running])

  return (
    <DialogShell
      title={`确认运行「${command.name}」`}
      subtitle="该命令已开启二次确认，请核对信息后运行。"
      closeDisabled={running}
      onClose={onClose}
    >
      <Box className="cr-form">
        <Typography component="dl" sx={{ margin: 0, display: 'grid', gap: 1, fontSize: 13 }}>
          <Box component="div" sx={{ display: 'grid', gridTemplateColumns: '80px minmax(0, 1fr)', gap: 1.5 }}>
            <Box component="dt" sx={{ margin: 0, color: 'text.secondary', fontWeight: 700 }}>仓库</Box>
            <Box component="dd" sx={{ margin: 0, minWidth: 0 }}>{repo.name}</Box>
          </Box>
          <Box component="div" sx={{ display: 'grid', gridTemplateColumns: '80px minmax(0, 1fr)', gap: 1.5 }}>
            <Box component="dt" sx={{ margin: 0, color: 'text.secondary', fontWeight: 700 }}>工作目录</Box>
            <Box component="dd" sx={{ margin: 0, minWidth: 0, overflowWrap: 'anywhere' }}>{repo.path}</Box>
          </Box>
          <Box component="div" sx={{ display: 'grid', gridTemplateColumns: '80px minmax(0, 1fr)', gap: 1.5 }}>
            <Box component="dt" sx={{ margin: 0, color: 'text.secondary', fontWeight: 700 }}>终端</Box>
            <Box component="dd" sx={{ margin: 0 }}>{shell ? shell.name : '未知'}</Box>
          </Box>
          <Box component="div" sx={{ display: 'grid', gridTemplateColumns: '80px minmax(0, 1fr)', gap: 1.5 }}>
            <Box component="dt" sx={{ margin: 0, color: 'text.secondary', fontWeight: 700 }}>关闭策略</Box>
            <Box component="dd" sx={{ margin: 0 }}>{closeModeLabel(closeMode, countdownSeconds)}</Box>
          </Box>
        </Typography>
        <pre className="cr-run-script">{command.script}</pre>
        {error ? <Alert severity="error" variant="outlined">{error}</Alert> : null}
        <Box className="cr-form-actions">
          <Button disabled={running} onClick={onClose}>取消</Button>
          <Button variant="contained" color="warning" disabled={disabled || running} onClick={confirm}>
            {running ? '启动中' : '确认运行'}
          </Button>
        </Box>
      </Box>
    </DialogShell>
  )
}
