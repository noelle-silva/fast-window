import * as React from 'react'
import FolderOpenOutlinedIcon from '@mui/icons-material/FolderOpenOutlined'
import { Box, Button, TextField } from '@mui/material'
import { invoke } from '@tauri-apps/api/core'
import { DialogShell } from './DialogShell'

type CustomShellDialogProps = {
  disabled?: boolean
  submitting?: boolean
  onAdd: (name: string, exePath: string, argsTemplate: string) => Promise<void> | void
  onClose: () => void
}

export function CustomShellDialog({ disabled = false, submitting = false, onAdd, onClose }: CustomShellDialogProps) {
  const [name, setName] = React.useState('')
  const [exePath, setExePath] = React.useState('')
  const [argsTemplate, setArgsTemplate] = React.useState('{command}')
  const [error, setError] = React.useState<string | null>(null)
  const canAdd = name.trim().length > 0 && exePath.trim().length > 0 && !disabled && !submitting

  const pickExecutable = React.useCallback(async () => {
    setError(null)
    try {
      const selected = await invoke<string | null>('pick_executable', { title: '选择命令行程序' })
      if (selected) setExePath(selected)
    } catch (e) {
      setError(String((e as { message?: string })?.message || e || '选择程序失败'))
    }
  }, [])

  const add = React.useCallback(async () => {
    if (!canAdd) return
    setError(null)
    try {
      await onAdd(name.trim(), exePath.trim(), argsTemplate.trim())
      onClose()
    } catch (e) {
      setError(String((e as { message?: string })?.message || e || '添加自定义终端失败'))
    }
  }, [canAdd, name, exePath, argsTemplate, onAdd, onClose])

  return (
    <DialogShell
      title="添加自定义终端"
      subtitle="登记本机未被自动探测到的命令行程序。"
      closeDisabled={submitting}
      onClose={onClose}
    >
      <Box component="form" className="cr-form" onSubmit={event => {
        event.preventDefault()
        void add()
      }}>
        <TextField
          autoFocus
          label="终端名称"
          value={name}
          disabled={disabled || submitting}
          onChange={event => setName(event.target.value)}
          fullWidth
        />
        <Box className="cr-path-row">
          <TextField
            label="程序路径"
            value={exePath}
            disabled={disabled || submitting}
            onChange={event => setExePath(event.target.value)}
            fullWidth
          />
          <Button type="button" onClick={pickExecutable} disabled={disabled || submitting} startIcon={<FolderOpenOutlinedIcon fontSize="small" />} sx={{ height: 56 }}>
            浏览
          </Button>
        </Box>
        <TextField
          label="参数模板"
          value={argsTemplate}
          disabled={disabled || submitting}
          onChange={event => setArgsTemplate(event.target.value)}
          fullWidth
          helperText="运行时 {command} 会被替换为脚本文件路径，例如 -NoProfile -ExecutionPolicy Bypass -File {command}"
        />
        {error ? <Box component="p" sx={{ margin: 0, color: 'error.main', fontSize: 12 }}>{error}</Box> : null}
        <Box className="cr-form-actions">
          <Button type="button" disabled={submitting} onClick={onClose}>取消</Button>
          <Button type="submit" variant="contained" disabled={!canAdd}>{submitting ? '添加中' : '添加终端'}</Button>
        </Box>
      </Box>
    </DialogShell>
  )
}
