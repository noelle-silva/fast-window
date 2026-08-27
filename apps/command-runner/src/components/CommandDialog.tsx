import * as React from 'react'
import { Box, Button, FormControlLabel, MenuItem, Switch, TextField } from '@mui/material'
import { DialogShell } from './DialogShell'
import { CloseModeSelect } from './CloseModeSelect'
import { ShellSelect } from './ShellSelect'
import type { CommandDraft, CommandItem, CommandRunMode, Repo, ShellInfo } from '../types'

type CommandDialogProps = {
  repo: Repo
  initial?: CommandItem | null
  shells: ShellInfo[]
  defaultCloseMode: string
  defaultCountdownSeconds: number
  disabled?: boolean
  submitting?: boolean
  onSubmit: (draft: CommandDraft) => Promise<void> | void
  onClose: () => void
}

const EMPTY_DRAFT: CommandDraft = {
  repoId: '',
  name: '',
  script: '',
  note: '',
  confirmBeforeRun: false,
  shellId: '',
  closeMode: '',
  countdownSeconds: 0,
  runMode: 'console',
}

const RUN_MODE_OPTIONS: Array<{ value: CommandRunMode; label: string; hint: string }> = [
  { value: 'console', label: '独立命令行窗口', hint: '弹出独立窗口运行，输出不在 App 内显示' },
  { value: 'embedded', label: '内置执行空间', hint: '不弹窗口，输出实时显示在 App 的执行空间页面' },
]

export function CommandDialog({
  repo,
  initial,
  shells,
  defaultCloseMode,
  defaultCountdownSeconds,
  disabled = false,
  submitting = false,
  onSubmit,
  onClose,
}: CommandDialogProps) {
  const [name, setName] = React.useState(initial?.name ?? '')
  const [script, setScript] = React.useState(initial?.script ?? '')
  const [note, setNote] = React.useState(initial?.note ?? '')
  const [confirmBeforeRun, setConfirmBeforeRun] = React.useState(initial?.confirmBeforeRun ?? false)
  const [shellId, setShellId] = React.useState(initial?.shellId ?? '')
  const [closeMode, setCloseMode] = React.useState(initial?.closeMode || defaultCloseMode)
  const [countdownSeconds, setCountdownSeconds] = React.useState(
    initial?.countdownSeconds || defaultCountdownSeconds,
  )
  const [runMode, setRunMode] = React.useState<CommandRunMode>(initial?.runMode || 'console')
  const [error, setError] = React.useState<string | null>(null)
  const canSave = name.trim().length > 0 && script.trim().length > 0 && !disabled && !submitting

  const save = React.useCallback(async () => {
    if (!canSave) return
    setError(null)
    try {
      await onSubmit({
        repoId: repo.id,
        name: name.trim(),
        script,
        note: note.trim(),
        confirmBeforeRun,
        shellId,
        closeMode,
        countdownSeconds: closeMode === 'countdown' ? countdownSeconds : 0,
        runMode,
      })
    } catch (e) {
      setError(String((e as { message?: string })?.message || e || '保存命令失败'))
    }
  }, [canSave, repo.id, name, script, note, confirmBeforeRun, shellId, closeMode, countdownSeconds, runMode, onSubmit])

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
      title={initial ? '编辑命令' : '新建命令'}
      subtitle={`仓库「${repo.name}」内的新命令将以该仓库目录为工作目录运行。`}
      closeDisabled={submitting}
      onClose={onClose}
    >
      <Box component="form" className="cr-form" onSubmit={event => {
        event.preventDefault()
        void save()
      }}>
        <TextField
          autoFocus
          label="命令名称"
          value={name}
          disabled={disabled || submitting}
          onChange={event => setName(event.target.value)}
          fullWidth
        />
        <TextField
          label="命令脚本"
          value={script}
          disabled={disabled || submitting}
          onChange={event => setScript(event.target.value)}
          fullWidth
          multiline
          minRows={4}
          placeholder={'例如：\nnpm run build\n或\npnpm install && pnpm dev'}
        />
        <TextField
          label="备注说明"
          value={note}
          disabled={disabled || submitting}
          onChange={event => setNote(event.target.value)}
          fullWidth
          multiline
          minRows={2}
        />
        <FormControlLabel
          control={<Switch checked={confirmBeforeRun} disabled={disabled || submitting} onChange={event => setConfirmBeforeRun(event.target.checked)} />}
          label="运行前需要二次确认"
          sx={{ alignSelf: 'flex-start' }}
        />
        <ShellSelect
          value={shellId}
          shells={shells}
          onChange={setShellId}
          includeInherit
          inheritLabel="留空时继承仓库默认终端"
          label="命令终端"
          disabled={disabled || submitting}
        />
        <TextField
          select
          label="运行模式"
          value={runMode}
          disabled={disabled || submitting}
          onChange={event => setRunMode(event.target.value as CommandRunMode)}
          fullWidth
        >
          {RUN_MODE_OPTIONS.map(option => (
            <MenuItem key={option.value} value={option.value}>
              <Box sx={{ minWidth: 0 }}>
                <Box component="span" sx={{ fontSize: 13, fontWeight: 700 }}>{option.label}</Box>
                <Box component="span" sx={{ display: 'block', color: 'text.secondary', fontSize: 11 }}>{option.hint}</Box>
              </Box>
            </MenuItem>
          ))}
        </TextField>
        <CloseModeSelect
          closeMode={closeMode}
          countdownSeconds={countdownSeconds}
          disabled={disabled || submitting}
          onChange={next => {
            setCloseMode(next.closeMode)
            setCountdownSeconds(next.countdownSeconds)
          }}
        />
        {error ? <Box component="p" sx={{ margin: 0, color: 'error.main', fontSize: 12 }}>{error}</Box> : null}
        <Box className="cr-form-actions">
          <Button type="button" disabled={submitting} onClick={onClose}>取消</Button>
          <Button type="submit" variant="contained" disabled={!canSave}>{submitting ? '保存中' : initial ? '保存修改' : '创建命令'}</Button>
        </Box>
      </Box>
    </DialogShell>
  )
}

export function emptyCommandDraft(repoId: string): CommandDraft {
  return { ...EMPTY_DRAFT, repoId }
}
