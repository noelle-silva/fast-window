import * as React from 'react'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import FolderCopyRoundedIcon from '@mui/icons-material/FolderCopyRounded'
import ImageRoundedIcon from '@mui/icons-material/ImageRounded'
import RestartAltRoundedIcon from '@mui/icons-material/RestartAltRounded'
import { Box, Button, Checkbox, Dialog, DialogContent, Divider, Paper, Stack, TextField, Typography, alpha } from '@mui/material'
import { DESKTOP_ICON_COLORS } from './folder-grid/desktopIconTokens'
import type { ContainerFormState, DesktopContainer, FolderItem, FoldersDoc, IconEditorState } from './types'

export function ContainerDialog(props: {
  busy: boolean
  doc: FoldersDoc
  editing: DesktopContainer | null
  form: ContainerFormState
  open: boolean
  onChange(form: ContainerFormState): void
  onClose(): void
  onSave(): void
}) {
  const selected = new Set(props.form.itemIds)
  return (
    <Dialog open={props.open} onClose={props.onClose} fullWidth maxWidth="sm">
      <DialogContent sx={{ p: 3 }}>
        <Stack spacing={2.25}>
          <Box>
            <Typography variant="h2">{props.editing ? '编辑收纳盒' : '创建收纳盒'}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>收纳盒会作为桌面图标显示，内部文件夹可以随时移回桌面。</Typography>
          </Box>
          <TextField label="名称" value={props.form.name} onChange={event => props.onChange({ ...props.form, name: event.target.value })} placeholder="例如：AI 工具" autoFocus fullWidth />
          <Stack spacing={1}>
            <Typography variant="caption" color="text.secondary">选择要收纳的文件夹</Typography>
            <Stack spacing={0.75} sx={{ maxHeight: 280, overflow: 'auto' }}>
              {props.doc.items.map(item => {
                const checked = selected.has(item.id)
                const containerName = item.containerId ? props.doc.containers.find(container => container.id === item.containerId)?.name : ''
                return (
                  <Button key={item.id} variant="text" onClick={() => props.onChange({ ...props.form, itemIds: checked ? props.form.itemIds.filter(id => id !== item.id) : [...props.form.itemIds, item.id] })} sx={{ justifyContent: 'flex-start', gap: 1, bgcolor: theme => alpha(theme.palette.primary.main, checked ? 0.12 : 0.05) }}>
                    <Checkbox checked={checked} tabIndex={-1} disableRipple />
                    <FolderCopyRoundedIcon fontSize="small" />
                    <Box sx={{ minWidth: 0, textAlign: 'left' }}>
                      <Typography noWrap fontWeight={900}>{item.name}</Typography>
                      <Typography variant="caption" color="text.secondary" noWrap>{containerName ? `当前在：${containerName}` : item.path}</Typography>
                    </Box>
                  </Button>
                )
              })}
            </Stack>
          </Stack>
          <Stack direction="row" spacing={1} justifyContent="flex-end">
            <Button onClick={props.onClose}>取消</Button>
            <Button variant="contained" onClick={props.onSave} disabled={props.busy}>{props.editing ? '保存' : '创建'}</Button>
          </Stack>
        </Stack>
      </DialogContent>
    </Dialog>
  )
}

export function ContainerViewDialog(props: {
  container: DesktopContainer | null
  doc: FoldersDoc
  onClose(): void
  onEdit(container: DesktopContainer): void
  onOpenFolder(item: FolderItem): void
  onRemoveItem(item: FolderItem): void
}) {
  const items = props.container ? props.doc.items.filter(item => item.containerId === props.container?.id) : []
  return (
    <Dialog open={Boolean(props.container)} onClose={props.onClose} fullWidth maxWidth="sm">
      <DialogContent sx={{ p: 3 }}>
        <Stack spacing={2.25}>
          <Box>
            <Typography variant="h2">{props.container?.name || '收纳盒'}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{items.length} 个文件夹</Typography>
          </Box>
          <Stack spacing={1} sx={{ maxHeight: 360, overflow: 'auto' }}>
            {items.length ? items.map(item => (
              <Paper key={item.id} elevation={0} sx={{ p: 1.25, borderRadius: 2.5, bgcolor: theme => alpha(theme.palette.primary.main, 0.06), display: 'flex', alignItems: 'center', gap: 1 }}>
                <FolderCopyRoundedIcon fontSize="small" />
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography noWrap fontWeight={900}>{item.name}</Typography>
                  <Typography variant="caption" color="text.secondary" noWrap>{item.path}</Typography>
                </Box>
                <Button onClick={() => props.onOpenFolder(item)}>打开</Button>
                <Button onClick={() => props.onRemoveItem(item)}>移出</Button>
              </Paper>
            )) : <Typography color="text.secondary">这个收纳盒还是空的。</Typography>}
          </Stack>
          <Stack direction="row" spacing={1} justifyContent="flex-end">
            {props.container ? <Button startIcon={<EditRoundedIcon />} onClick={() => props.onEdit(props.container!)}>编辑</Button> : null}
            <Button variant="contained" onClick={props.onClose}>完成</Button>
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
