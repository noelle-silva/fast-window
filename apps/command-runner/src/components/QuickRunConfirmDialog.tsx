import * as React from 'react'
import { Alert, Box, Button, Chip, Typography } from '@mui/material'
import { DialogShell } from './DialogShell'
import type { CommandItem, QuickRun, Repo } from '../types'

type QuickRunConfirmDialogProps = {
  quickRun: QuickRun
  commands: CommandItem[]
  repos: Repo[]
  disabled?: boolean
  onConfirm: () => Promise<void> | void
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
  const repoNameById = React.useMemo(() => new Map(repos.map(repo => [repo.id, repo.name])), [repos])
  const rows = quickRun.commandIds.map(id => {
    const command = commandById.get(id)
    return {
      id,
      name: command?.name || id,
      repoName: command ? (repoNameById.get(command.repoId) || '未知仓库') : '未知仓库',
      confirmRequired: command?.confirmBeforeRun ?? false,
    }
  })
  const confirmCount = rows.filter(row => row.confirmRequired).length

  const confirm = React.useCallback(async () => {
    if (running) return
    setRunning(true)
    setError(null)
    try {
      await onConfirm()
    } catch (e) {
      setError(String((e as { message?: string })?.message || e || '启动快捷运行失败'))
      setRunning(false)
    }
  }, [onConfirm, running])

  return (
    <DialogShell
      title={`确认运行「${quickRun.name}」`}
      subtitle={`该快捷运行包含 ${confirmCount} 条已开启二次确认的命令，确认后将启动全部 ${rows.length} 条命令。`}
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
