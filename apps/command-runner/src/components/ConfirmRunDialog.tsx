import * as React from 'react'
import { Alert, Box, Button, MenuItem, TextField, Typography } from '@mui/material'
import { DialogShell } from './DialogShell'
import { closeModeLabel, resolveCloseMode, resolveCountdownSeconds, resolveShellInfo } from '../shellResolve'
import { resolveCommandPlaceholders } from '../placeholders'
import type { AppSettings, CommandItem, PlaceholderSelection, Repo, ShellInfo } from '../types'

type ConfirmRunDialogProps = {
  command: CommandItem
  repo: Repo
  settings: AppSettings | null
  shells: ShellInfo[]
  disabled?: boolean
  variant?: 'run' | 'restart'
  onConfirm: (placeholderValues: PlaceholderSelection) => Promise<void> | void
  onClose: () => void
}

export function ConfirmRunDialog({ command, repo, settings, shells, disabled = false, variant = 'run', onConfirm, onClose }: ConfirmRunDialogProps) {
  const restart = variant === 'restart'
  const shell = resolveShellInfo(command.shellId, repo.shellId, settings, shells)
  const closeMode = resolveCloseMode(command, settings)
  const countdownSeconds = resolveCountdownSeconds(command, settings)
  const placeholders = React.useMemo(() => resolveCommandPlaceholders(command, repo), [command, repo])
  const [values, setValues] = React.useState<PlaceholderSelection>(() =>
    Object.fromEntries(placeholders.map(item => [item.name, item.values[0]])),
  )
  const [error, setError] = React.useState<string | null>(null)
  const [running, setRunning] = React.useState(false)

  const subtitle = React.useMemo(() => {
    const parts: string[] = []
    if (command.confirmBeforeRun) parts.push('该命令已开启二次确认，请核对信息。')
    if (placeholders.length > 0) parts.push('占位符取值只作用于本次运行。')
    if (restart) parts.push('确认后将停止当前实例并重新运行。')
    return parts.join('') || '请核对信息后运行。'
  }, [command.confirmBeforeRun, placeholders.length, restart])

  const confirm = React.useCallback(async () => {
    if (running) return
    setRunning(true)
    setError(null)
    try {
      await onConfirm(values)
      // 运行发起成功（命令可能仍在后台运行），关闭确认弹窗。
      onClose()
    } catch (e) {
      setError(String((e as { message?: string })?.message || e || '运行命令失败'))
      setRunning(false)
    }
  }, [onConfirm, onClose, running, values])

  return (
    <DialogShell
      title={restart ? `确认重新运行「${command.name}」` : `确认运行「${command.name}」`}
      subtitle={subtitle}
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
        {placeholders.length > 0 ? (
          <Box className="cr-placeholder-select">
            <Typography component="h3" sx={{ fontSize: 13, fontWeight: 900 }}>本次运行的占位符取值</Typography>
            {placeholders.map(item => (
              <Box key={item.name} className="cr-placeholder-select-row">
                <Box component="code" className="cr-placeholder-ref">{`{{${item.name}}}`}</Box>
                <TextField
                  select
                  size="small"
                  value={values[item.name] ?? ''}
                  disabled={disabled || running}
                  onChange={event => setValues(current => ({ ...current, [item.name]: event.target.value }))}
                  fullWidth
                >
                  {item.values.map(value => <MenuItem key={value} value={value}>{value}</MenuItem>)}
                </TextField>
              </Box>
            ))}
          </Box>
        ) : null}
        {error ? <Alert severity="error">{error}</Alert> : null}
        <Box className="cr-form-actions">
          <Button disabled={running} onClick={onClose}>取消</Button>
          <Button variant="contained" color="warning" disabled={disabled || running} onClick={confirm}>
            {running ? (restart ? '重启中' : '启动中') : restart ? '确认重新运行' : '确认运行'}
          </Button>
        </Box>
      </Box>
    </DialogShell>
  )
}
