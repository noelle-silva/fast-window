import { useEffect, useState } from 'react'
import {
  Avatar, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, Stack, TextField, Typography,
} from '@mui/material'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import type { RegisteredAppShortcut } from './types'
import type { IconImageSource } from '../iconImageInput'
import { readIconImageDataUrl } from '../iconImageInput'
import { buildShortcutFromEvent, pauseShortcutRecordingGuards, resumeShortcutRecordingGuards } from '../shortcuts'
import { resolveHostShortcutIcon, resolveHostShortcutIconImageUrl } from './hostShortcutIcon'
import { hostButtonSx, hostDangerButtonSx, hostTextFieldSx } from '../components/hostUiStyles'
import { hostToast } from '../host/hostPrimitives'

interface AppHostShortcutEditDialogProps {
  open: boolean
  shortcut: RegisteredAppShortcut | null
  appIcon: string
  appName: string
  onClose: () => void
  onCommit: (next: RegisteredAppShortcut) => void
  onRemove: () => void
}

export default function AppHostShortcutEditDialog({
  open,
  shortcut,
  appIcon,
  appName,
  onClose,
  onCommit,
  onRemove,
}: AppHostShortcutEditDialogProps) {
  const [title, setTitle] = useState('')
  const [shortcutId, setShortcutId] = useState('')
  const [hotkey, setHotkey] = useState('')
  const [icon, setIcon] = useState('')
  const [recording, setRecording] = useState(false)
  const [pickingIcon, setPickingIcon] = useState(false)

  useEffect(() => {
    if (!open || !shortcut) return
    setTitle(shortcut.title)
    setShortcutId(shortcut.id)
    setHotkey(shortcut.hotkey || '')
    setIcon(shortcut.icon || '')
    setRecording(false)
    setPickingIcon(false)
  }, [open, shortcut])

  useEffect(() => {
    if (!recording) return

    pauseShortcutRecordingGuards()

    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      ;(e as any).stopImmediatePropagation?.()

      if (e.key === 'Escape') {
        setRecording(false)
        return
      }

      if (e.repeat) return
      const shot = buildShortcutFromEvent(e)
      if (!shot) return
      setHotkey(shot)
      setRecording(false)
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      resumeShortcutRecordingGuards()
    }
  }, [recording])

  const pickIcon = async (source: IconImageSource) => {
    setPickingIcon(true)
    try {
      const dataUrl = await readIconImageDataUrl(source)
      if (!dataUrl) return
      setIcon(dataUrl)
    } catch (error: any) {
      await hostToast(String(error?.message || error || '更改快捷命令图标失败'))
    } finally {
      setPickingIcon(false)
    }
  }

  const commit = () => {
    const nextTitle = title.trim()
    const nextId = shortcutId.trim()
    if (!nextTitle || !nextId) {
      void hostToast('快捷命令名称和 ID 不能为空')
      return
    }
    onCommit({
      id: nextId,
      title: nextTitle,
      hotkey: hotkey.trim() || undefined,
      icon: icon || undefined,
    })
  }

  const previewShortcut: RegisteredAppShortcut = { id: shortcutId, title, icon: icon || undefined }
  const iconImageUrl = resolveHostShortcutIconImageUrl(previewShortcut, appIcon)
  const iconFallback = resolveHostShortcutIcon(previewShortcut, appIcon)

  return (
    <Dialog open={open && !!shortcut} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ pr: 6 }}>
        编辑宿主快捷命令
        <IconButton aria-label="关闭" onClick={onClose} sx={{ position: 'absolute', right: 8, top: 8 }} size="small">
          <CloseRoundedIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
          <Avatar
            variant="rounded"
            src={iconImageUrl}
            imgProps={{ alt: `${title || appName || '宿主快捷命令'} 图标预览` }}
            sx={{ width: 44, height: 44, fontSize: 20, bgcolor: 'action.hover', color: 'text.primary', flexShrink: 0 }}
          >
            {iconImageUrl ? null : iconFallback}
          </Avatar>
          <Box sx={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
            <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap' }}>
              <Button size="small" variant="text" sx={hostButtonSx} disabled={pickingIcon} onClick={() => void pickIcon('file')}>
                选择图片
              </Button>
              <Button size="small" variant="text" sx={hostButtonSx} disabled={pickingIcon} onClick={() => void pickIcon('clipboard')}>
                粘贴图片
              </Button>
              <Button size="small" variant="text" sx={hostButtonSx} disabled={pickingIcon || !icon} onClick={() => setIcon('')}>
                跟随主页
              </Button>
            </Stack>
            <Typography variant="caption" color="text.secondary">
              未设置独立图标时跟随主页图标。
            </Typography>
          </Box>
        </Box>

        <TextField
          label="快捷命令名称"
          value={title}
          onChange={e => setTitle(e.target.value)}
          size="small"
          fullWidth
          sx={hostTextFieldSx}
        />

        <TextField
          label="快捷命令 ID"
          value={shortcutId}
          onChange={e => setShortcutId(e.target.value)}
          size="small"
          fullWidth
          sx={hostTextFieldSx}
        />

        <TextField
          label="快捷命令快捷键"
          value={hotkey}
          size="small"
          fullWidth
          placeholder="点击录制然后按键"
          InputProps={{ readOnly: true }}
          helperText={recording ? '录制中…按 ESC 取消，按下组合键即可保存到输入框里。' : '点击开始录制，然后按下组合键。'}
          sx={hostTextFieldSx}
        />

        <Stack direction="row" spacing={1}>
          <Button
            variant={recording ? 'contained' : 'text'}
            color={recording ? 'warning' : 'primary'}
            sx={hostButtonSx}
            onClick={() => setRecording(v => !v)}
          >
            {recording ? '录制中…' : '开始录制'}
          </Button>
          <Button variant="text" sx={hostButtonSx} disabled={!hotkey} onClick={() => setHotkey('')}>
            清空快捷键
          </Button>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ justifyContent: 'space-between', px: 3, pb: 2 }}>
        <Button variant="text" color="error" sx={hostDangerButtonSx} onClick={onRemove}>
          删除
        </Button>
        <Box>
          <Button onClick={onClose} sx={{ mr: 1 }}>取消</Button>
          <Button variant="contained" sx={hostButtonSx} onClick={commit}>完成</Button>
        </Box>
      </DialogActions>
    </Dialog>
  )
}
