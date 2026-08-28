import * as React from 'react'
import FolderOpenOutlinedIcon from '@mui/icons-material/FolderOpenOutlined'
import { Box, Button, TextField } from '@mui/material'
import { invoke } from '@tauri-apps/api/core'
import { DialogShell } from './DialogShell'
import { CloseModeSelect } from './CloseModeSelect'
import { ShellSelect } from './ShellSelect'
import { ProcessOwnershipSelect } from './ProcessOwnershipSelect'
import { RunModeSelect } from './RunModeSelect'
import type { AppSettings, CommandRunMode, ProcessOwnership, Repo, ShellInfo } from '../types'

type RepoDialogProps = {
  title: string
  submitLabel: string
  initial?: Repo | null
  shells: ShellInfo[]
  settings: AppSettings | null
  disabled?: boolean
  submitting?: boolean
  onSubmit: (draft: { name: string; path: string; shellId: string; closeMode: string; countdownSeconds: number; runMode: CommandRunMode | ''; processOwnership: ProcessOwnership }) => Promise<void> | void
  onClose: () => void
}

export function RepoDialog({
  title,
  submitLabel,
  initial,
  shells,
  settings,
  disabled = false,
  submitting = false,
  onSubmit,
  onClose,
}: RepoDialogProps) {
  const defaultShellId = settings?.defaultShellId || 'cmd'
  const defaultCloseMode = settings?.defaultCloseMode || 'keep-open'
  const defaultCountdownSeconds = settings?.defaultCountdownSeconds || 10
  const [name, setName] = React.useState(initial?.name ?? '')
  const [path, setPath] = React.useState(initial?.path ?? '')
  const [shellId, setShellId] = React.useState(initial?.shellId ?? defaultShellId)
  const [closeMode, setCloseMode] = React.useState(initial?.closeMode ?? '')
  const [countdownSeconds, setCountdownSeconds] = React.useState(initial?.countdownSeconds ?? defaultCountdownSeconds)
  const [runMode, setRunMode] = React.useState<CommandRunMode | ''>(initial?.runMode ?? '')
  const [processOwnership, setProcessOwnership] = React.useState<ProcessOwnership>(initial?.processOwnership ?? '')
  const [error, setError] = React.useState<string | null>(null)
  const canSave = name.trim().length > 0 && path.trim().length > 0 && !disabled && !submitting

  const pickFolder = React.useCallback(async () => {
    setError(null)
    try {
      const selected = await invoke<string | null>('pick_folder', { title: '选择仓库目录' })
      if (selected) setPath(selected)
    } catch (e) {
      setError(String((e as { message?: string })?.message || e || '选择目录失败'))
    }
  }, [])

  const save = React.useCallback(async () => {
    if (!canSave) return
    setError(null)
    try {
      await onSubmit({ name: name.trim(), path: path.trim(), shellId, closeMode, countdownSeconds: closeMode === 'countdown' ? countdownSeconds : 0, runMode, processOwnership })
    } catch (e) {
      setError(String((e as { message?: string })?.message || e || '保存仓库失败'))
    }
  }, [canSave, name, path, shellId, closeMode, countdownSeconds, runMode, processOwnership, onSubmit])

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void save()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [save])

  return (
    <DialogShell
      title={title}
      subtitle="注册本地仓库目录，仓库内的命令都以该目录为工作目录运行。"
      closeDisabled={submitting}
      onClose={onClose}
    >
      <Box component="form" className="cr-form" onSubmit={event => {
        event.preventDefault()
        void save()
      }}>
        <TextField
          autoFocus
          label="仓库名称"
          value={name}
          disabled={disabled || submitting}
          onChange={event => setName(event.target.value)}
          fullWidth
        />
        <Box className="cr-path-row">
          <TextField
            label="仓库目录"
            value={path}
            disabled={disabled || submitting}
            onChange={event => setPath(event.target.value)}
            fullWidth
          />
          <Button type="button" onClick={pickFolder} disabled={disabled || submitting} startIcon={<FolderOpenOutlinedIcon fontSize="small" />} sx={{ height: 56 }}>
            浏览
          </Button>
        </Box>
        <ShellSelect value={shellId} shells={shells} onChange={setShellId} disabled={disabled || submitting} label="仓库默认终端" />
        <CloseModeSelect
          closeMode={closeMode}
          countdownSeconds={countdownSeconds}
          includeInherit
          inheritLabel="跟随全局默认关闭策略"
          effectiveMode={defaultCloseMode}
          effectiveCountdown={defaultCountdownSeconds}
          disabled={disabled || submitting}
          onChange={next => {
            setCloseMode(next.closeMode)
            setCountdownSeconds(next.countdownSeconds)
          }}
        />
        <RunModeSelect value={runMode} onChange={setRunMode} includeInherit inheritLabel="跟随全局默认运行模式" effectiveValue={(settings?.defaultRunMode || 'console') as CommandRunMode | ''} label="默认运行模式" disabled={disabled || submitting} />
        <ProcessOwnershipSelect value={processOwnership} onChange={setProcessOwnership} includeInherit inheritLabel="跟随全局默认进程归属" effectiveValue={(settings?.defaultProcessOwnership || 'detached') as ProcessOwnership} label="外部窗口进程归属" disabled={disabled || submitting} />
        {error ? <Box component="p" sx={{ margin: 0, color: 'error.main', fontSize: 12 }}>{error}</Box> : null}
        <Box className="cr-form-actions">
          <Button type="button" disabled={submitting} onClick={onClose}>取消</Button>
          <Button type="submit" variant="contained" disabled={!canSave}>{submitting ? '保存中' : submitLabel}</Button>
        </Box>
      </Box>
    </DialogShell>
  )
}
