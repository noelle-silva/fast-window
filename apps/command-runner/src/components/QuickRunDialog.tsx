import * as React from 'react'
import { Box, Button, Checkbox, FormControlLabel, TextField, Typography } from '@mui/material'
import { DialogShell } from './DialogShell'
import type { CommandItem, QuickRun, Repo } from '../types'

type QuickRunDialogProps = {
  title: string
  subtitle?: string
  submitLabel: string
  initial?: QuickRun | null
  commands: CommandItem[]
  repos: Repo[]
  disabled?: boolean
  submitting?: boolean
  onSubmit: (name: string, commandIds: string[]) => Promise<void> | void
  onClose: () => void
}

export function QuickRunDialog({
  title,
  subtitle,
  submitLabel,
  initial,
  commands,
  repos,
  disabled = false,
  submitting = false,
  onSubmit,
  onClose,
}: QuickRunDialogProps) {
  const [name, setName] = React.useState(initial?.name ?? '')
  const [selectedIds, setSelectedIds] = React.useState<string[]>(() => {
    const known = new Set(commands.map(command => command.id))
    return (initial?.commandIds ?? []).filter(id => known.has(id))
  })
  const [keyword, setKeyword] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const canSave = name.trim().length > 0 && selectedIds.length > 0 && !disabled && !submitting
  const hasCommands = commands.length > 0

  const normalizedKeyword = keyword.trim().toLowerCase()
  const groups = React.useMemo(() => repos
    .map(repo => {
      const repoCommands = commands.filter(command => command.repoId === repo.id)
      const visible = !normalizedKeyword
        ? repoCommands
        : repo.name.toLowerCase().includes(normalizedKeyword)
          ? repoCommands
          : repoCommands.filter(command => command.name.toLowerCase().includes(normalizedKeyword))
      return { repo, commands: visible }
    })
    .filter(group => group.commands.length > 0),
  [repos, commands, normalizedKeyword])

  const toggle = React.useCallback((commandId: string) => {
    setSelectedIds(current => current.includes(commandId)
      ? current.filter(id => id !== commandId)
      : [...current, commandId])
  }, [])

  const save = React.useCallback(async () => {
    if (!canSave) return
    setError(null)
    try {
      await onSubmit(name.trim(), selectedIds)
    } catch (e) {
      setError(String((e as { message?: string })?.message || e || '保存快捷运行失败'))
    }
  }, [canSave, name, selectedIds, onSubmit])

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
      subtitle={subtitle}
      closeDisabled={submitting}
      onClose={onClose}
    >
      <Box component="form" className="cr-form" onSubmit={event => {
        event.preventDefault()
        void save()
      }}>
        <TextField
          autoFocus
          label="快捷运行名称"
          value={name}
          disabled={disabled || submitting}
          onChange={event => setName(event.target.value)}
          fullWidth
        />
        <Box>
          <Box sx={{ mb: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
            <Typography component="h3" sx={{ fontSize: 13, fontWeight: 900 }}>选择命令</Typography>
            <Typography color="text.secondary" sx={{ fontSize: 12 }}>已选 {selectedIds.length} 条</Typography>
          </Box>
          <TextField
            size="small"
            placeholder="按命令名或仓库名过滤"
            value={keyword}
            disabled={disabled || submitting || !hasCommands}
            onChange={event => setKeyword(event.target.value)}
            fullWidth
            sx={{ mb: 1 }}
          />
          {hasCommands ? (
            <Box className="cr-quick-run-picker">
              {groups.map(group => (
                <Box key={group.repo.id} className="cr-quick-run-group">
                  <Typography component="h4" className="cr-quick-run-group-title">{group.repo.name}</Typography>
                  {group.commands.map(command => (
                    <FormControlLabel
                      key={command.id}
                      className="cr-quick-run-option"
                      control={(
                        <Checkbox
                          size="small"
                          checked={selectedIds.includes(command.id)}
                          disabled={disabled || submitting}
                          onChange={() => toggle(command.id)}
                        />
                      )}
                      label={(
                        <Box className="cr-quick-run-option-label">
                          <Typography component="span" sx={{ fontSize: 13, fontWeight: 700 }} noWrap>{command.name}</Typography>
                          {command.script.trim() ? (
                            <Typography component="span" color="text.secondary" className="cr-quick-run-option-script">{command.script}</Typography>
                          ) : null}
                        </Box>
                      )}
                    />
                  ))}
                </Box>
              ))}
              {groups.length === 0 ? (
                <Typography color="text.secondary" sx={{ p: 2, textAlign: 'center', fontSize: 12 }}>没有匹配的命令</Typography>
              ) : null}
            </Box>
          ) : (
            <Box className="cr-quick-run-picker cr-quick-run-picker-empty">
              <Typography color="text.secondary" sx={{ fontSize: 12 }}>还没有已注册的命令。先到仓库里创建命令，再回来组队。</Typography>
            </Box>
          )}
        </Box>
        {error ? <Box component="p" sx={{ margin: 0, color: 'error.main', fontSize: 12 }}>{error}</Box> : null}
        <Box className="cr-form-actions">
          <Button type="button" disabled={submitting} onClick={onClose}>取消</Button>
          <Button type="submit" variant="contained" disabled={!canSave}>{submitting ? '保存中' : submitLabel}</Button>
        </Box>
      </Box>
    </DialogShell>
  )
}
