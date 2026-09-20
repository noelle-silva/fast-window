import * as React from 'react'
import { Alert, Box, Button, Chip, MenuItem, TextField, Typography } from '@mui/material'
import { DialogShell } from './DialogShell'
import { placeholderReference, resolveCommandPlaceholders } from '../placeholders'
import type { CommandItem, QuickRun, QuickRunPlaceholderSelection, Repo } from '../types'

type QuickRunConfirmDialogProps = {
  quickRun: QuickRun
  commands: CommandItem[]
  repos: Repo[]
  disabled?: boolean
  onConfirm: (placeholderValues: QuickRunPlaceholderSelection) => Promise<void> | void
  onClose: () => void
}

export function QuickRunConfirmDialog({
  quickRun,
  commands,
  repos,
  disabled = false,
  onConfirm,
  onClose,
}: QuickRunConfirmDialogProps) {
  const [error, setError] = React.useState<string | null>(null)
  const [running, setRunning] = React.useState(false)

  const commandById = React.useMemo(() => new Map(commands.map(command => [command.id, command])), [commands])
  const repoById = React.useMemo(() => new Map(repos.map(repo => [repo.id, repo])), [repos])
  const rows = React.useMemo(() => quickRun.commandIds.map(id => {
    const command = commandById.get(id)
    const repo = command ? repoById.get(command.repoId) ?? null : null
    return {
      id,
      command,
      name: command?.name || id,
      repoName: repo?.name || '未知仓库',
      confirmRequired: command?.confirmBeforeRun ?? false,
      placeholders: command ? resolveCommandPlaceholders(command, repo) : [],
    }
  }), [quickRun.commandIds, commandById, repoById])
  const confirmCount = rows.filter(row => row.confirmRequired).length
  const placeholderCount = rows.reduce((sum, row) => sum + row.placeholders.length, 0)
  const [values, setValues] = React.useState<QuickRunPlaceholderSelection>(() =>
    Object.fromEntries(rows
      .filter(row => row.placeholders.length > 0)
      .map(row => [row.id, Object.fromEntries(row.placeholders.map(item => [item.name, item.values[0]]))])),
  )

  const subtitle = React.useMemo(() => {
    const parts: string[] = []
    if (confirmCount > 0) parts.push(`包含 ${confirmCount} 条已开启二次确认的命令`)
    if (placeholderCount > 0) parts.push(`包含 ${placeholderCount} 个待选占位符`)
    if (parts.length === 0) return `确认后将启动全部 ${rows.length} 条命令。`
    return `该快捷运行${parts.join('、')}，取值只作用于本次运行；确认后将启动全部 ${rows.length} 条命令。`
  }, [confirmCount, placeholderCount, rows.length])

  const confirm = React.useCallback(async () => {
    if (running) return
    setRunning(true)
    setError(null)
    try {
      await onConfirm(values)
    } catch (e) {
      setError(String((e as { message?: string })?.message || e || '启动快捷运行失败'))
      setRunning(false)
    }
  }, [onConfirm, running, values])

  return (
    <DialogShell
      title={`确认运行「${quickRun.name}」`}
      subtitle={subtitle}
      closeDisabled={running}
      onClose={onClose}
    >
      <Box className="cr-form">
        <Box className="cr-quick-run-confirm-list">
          {rows.map(row => (
            <Box key={row.id} className="cr-quick-run-confirm-item">
              <Box sx={{ minWidth: 0, display: 'grid', gap: 0.25 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 700 }} noWrap>{row.name}</Typography>
                <Typography color="text.secondary" sx={{ fontSize: 12 }} noWrap>{row.repoName}</Typography>
              </Box>
              {row.confirmRequired ? <Chip size="small" color="warning" label="需确认" sx={{ fontWeight: 800 }} /> : null}
              {row.placeholders.length > 0 ? (
                <Box className="cr-quick-run-confirm-placeholders">
                  {row.placeholders.map(item => (
                    <Box key={item.name} className="cr-placeholder-select-row">
                      <Box component="code" className="cr-placeholder-ref">{placeholderReference(item.name)}</Box>
                      <TextField
                        select
                        size="small"
                        value={values[row.id]?.[item.name] ?? ''}
                        disabled={disabled || running}
                        onChange={event => setValues(current => ({
                          ...current,
                          [row.id]: { ...current[row.id], [item.name]: event.target.value },
                        }))}
                        fullWidth
                      >
                        {item.values.map(value => <MenuItem key={value} value={value}>{value}</MenuItem>)}
                      </TextField>
                    </Box>
                  ))}
                </Box>
              ) : null}
            </Box>
          ))}
        </Box>
        {error ? <Alert severity="error">{error}</Alert> : null}
        <Box className="cr-form-actions">
          <Button disabled={running} onClick={onClose}>取消</Button>
          <Button variant="contained" color="warning" disabled={disabled || running} onClick={confirm}>
            {running ? '启动中' : `全部运行（${rows.length} 条）`}
          </Button>
        </Box>
      </Box>
    </DialogShell>
  )
}
