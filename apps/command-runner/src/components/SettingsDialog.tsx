import * as React from 'react'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined'
import { Box, Button, Chip, IconButton, TextField, Typography } from '@mui/material'
import { DialogShell } from './DialogShell'
import { CustomShellDialog } from './CustomShellDialog'
import { CloseModeSelect } from './CloseModeSelect'
import { ShellSelect } from './ShellSelect'
import type { AppSettings, ShellInfo } from '../types'

type SettingsDialogProps = {
  settings: AppSettings
  shells: ShellInfo[]
  disabled?: boolean
  submitting?: boolean
  onSaveSettings: (draft: { defaultShellId: string; defaultCloseMode: string; defaultCountdownSeconds: number }) => Promise<void> | void
  onAddCustomShell: (name: string, exePath: string, argsTemplate: string) => Promise<void> | void
  onRemoveCustomShell: (id: string) => Promise<void> | void
  onClose: () => void
}

export function SettingsDialog({
  settings,
  shells,
  disabled = false,
  submitting = false,
  onSaveSettings,
  onAddCustomShell,
  onRemoveCustomShell,
  onClose,
}: SettingsDialogProps) {
  const [defaultShellId, setDefaultShellId] = React.useState(settings.defaultShellId)
  const [closeMode, setCloseMode] = React.useState(settings.defaultCloseMode)
  const [countdownSeconds, setCountdownSeconds] = React.useState(settings.defaultCountdownSeconds)
  const [addShellOpen, setAddShellOpen] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState<string | null>(null)

  const save = React.useCallback(async () => {
    setError(null)
    setNotice(null)
    try {
      await onSaveSettings({ defaultShellId, defaultCloseMode: closeMode, defaultCountdownSeconds: countdownSeconds })
      setNotice('全局设置已保存')
    } catch (e) {
      setError(String((e as { message?: string })?.message || e || '保存设置失败'))
    }
  }, [defaultShellId, closeMode, countdownSeconds, onSaveSettings])

  const removeShell = React.useCallback(async (id: string) => {
    setError(null)
    setNotice(null)
    try {
      await onRemoveCustomShell(id)
      setNotice('自定义终端已移除')
    } catch (e) {
      setError(String((e as { message?: string })?.message || e || '移除自定义终端失败'))
    }
  }, [onRemoveCustomShell])

  return (
    <DialogShell
      title="Command Runner 设置"
      subtitle="全局默认设置对未单独配置的仓库与命令生效。"
      closeDisabled={submitting}
      onClose={onClose}
    >
      <Box className="cr-form">
        <Typography className="cr-section-title" component="h3">全局默认</Typography>
        <ShellSelect value={defaultShellId} shells={shells} onChange={setDefaultShellId} label="全局默认终端" disabled={disabled || submitting} />
        <CloseModeSelect
          closeMode={closeMode}
          countdownSeconds={countdownSeconds}
          disabled={disabled || submitting}
          onChange={next => {
            setCloseMode(next.closeMode)
            setCountdownSeconds(next.countdownSeconds)
          }}
        />
        <Box className="cr-form-actions" sx={{ justifyContent: 'flex-start' }}>
          <Button variant="contained" onClick={save} disabled={disabled || submitting}>保存全局设置</Button>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography className="cr-section-title" component="h3">自定义终端</Typography>
          <Box className="cr-topbar-spacer" />
          <Button size="small" startIcon={<AddIcon fontSize="small" />} onClick={() => setAddShellOpen(true)} disabled={disabled || submitting}>
            添加终端
          </Button>
        </Box>
        <Typography color="text.secondary" sx={{ fontSize: 12 }}>
          自动探测未覆盖的命令行程序可以在此登记，登记时为其填写参数模板。
        </Typography>
        <Box className="cr-custom-shell-list">
          {settings.customShells.length === 0 ? (
            <Typography color="text.secondary" sx={{ fontSize: 12 }}>尚未登记自定义终端。</Typography>
          ) : settings.customShells.map(custom => (
            <Box key={custom.id} className="cr-custom-shell-item">
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 800 }} noWrap>{custom.name}</Typography>
                <Typography color="text.secondary" sx={{ fontSize: 11 }} noWrap>{custom.exePath}</Typography>
                <Typography color="text.secondary" sx={{ fontSize: 11 }} noWrap>参数模板: {custom.argsTemplate}</Typography>
              </Box>
              <IconButton size="small" aria-label={`移除 ${custom.name}`} disabled={disabled || submitting} onClick={() => void removeShell(custom.id)}>
                <DeleteOutlineOutlinedIcon fontSize="small" />
              </IconButton>
            </Box>
          ))}
        </Box>

        {error ? <Box component="p" sx={{ margin: 0, color: 'error.main', fontSize: 12 }}>{error}</Box> : null}
        {notice ? (
          <Chip color="success" size="small" variant="outlined" label={notice} sx={{ justifySelf: 'start' }} />
        ) : null}
      </Box>

      {addShellOpen ? (
        <CustomShellDialog
          disabled={disabled}
          submitting={submitting}
          onAdd={onAddCustomShell}
          onClose={() => setAddShellOpen(false)}
        />
      ) : null}
    </DialogShell>
  )
}
