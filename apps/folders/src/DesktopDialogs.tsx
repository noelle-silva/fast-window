import * as React from 'react'
import ImageRoundedIcon from '@mui/icons-material/ImageRounded'
import RestartAltRoundedIcon from '@mui/icons-material/RestartAltRounded'
import { Box, Button, Dialog, DialogContent, Divider, Stack, TextField, Typography } from '@mui/material'
import { DESKTOP_ICON_COLORS } from './folder-grid/desktopIconTokens'
import type { ContainerFormState, DesktopContainer, IconEditorState } from './types'

export function ContainerDialog(props: {
  busy: boolean
  editing: DesktopContainer | null
  form: ContainerFormState
  open: boolean
  onChange(form: ContainerFormState): void
  onClose(): void
  onSave(): void
}) {
  return (
    <Dialog open={props.open} onClose={props.onClose} fullWidth maxWidth="sm">
      <DialogContent sx={{ p: 3 }}>
        <Stack spacing={2.25}>
          <Box>
            <Typography variant="h2">{props.editing ? '编辑收纳夹' : '创建收纳夹'}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>收纳夹会作为桌面图标显示；内容通过拖拽放入，内部位置也会直接保存。</Typography>
          </Box>
          <TextField label="名称" value={props.form.name} onChange={event => props.onChange({ ...props.form, name: event.target.value })} placeholder="例如：AI 工具" autoFocus fullWidth />
          <Typography variant="caption" color="text.secondary">把桌面文件夹拖到收纳夹上停留即可展开并放入；打开收纳夹后也可以直接拖动内部图标排序。</Typography>
          <Stack direction="row" spacing={1} justifyContent="flex-end">
            <Button onClick={props.onClose}>取消</Button>
            <Button variant="contained" onClick={props.onSave} disabled={props.busy}>{props.editing ? '保存' : '创建'}</Button>
          </Stack>
        </Stack>
      </DialogContent>
    </Dialog>
  )
}

export function IconEditorDialog(props: {
  busy: boolean
  state: IconEditorState
  onClose(): void
  onPickImage(): void
  onReset(): void
  onSaveColor(color: string): void
}) {
  return (
    <Dialog open={Boolean(props.state)} onClose={props.onClose} fullWidth maxWidth="xs">
      <DialogContent sx={{ p: 3 }}>
        <Stack spacing={2.25}>
          <Box>
            <Typography variant="h2">图标外观</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{props.state?.label || ''}</Typography>
          </Box>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1 }}>
            {DESKTOP_ICON_COLORS.map(color => (
              <Button key={color} aria-label={`使用颜色 ${color}`} onClick={() => props.onSaveColor(color)} disabled={props.busy} sx={{ height: 48, borderRadius: 3, bgcolor: color, minWidth: 0, '&:hover': { bgcolor: color } }} />
            ))}
          </Box>
          <Divider />
          <Stack direction="row" spacing={1} justifyContent="flex-end" flexWrap="wrap">
            <Button startIcon={<RestartAltRoundedIcon />} onClick={props.onReset} disabled={props.busy}>默认</Button>
            <Button startIcon={<ImageRoundedIcon />} onClick={props.onPickImage} disabled={props.busy}>选择图片</Button>
            <Button variant="contained" onClick={props.onClose}>完成</Button>
          </Stack>
        </Stack>
      </DialogContent>
    </Dialog>
  )
}
