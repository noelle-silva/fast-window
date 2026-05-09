import * as React from 'react'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import LanguageRoundedIcon from '@mui/icons-material/LanguageRounded'
import { Alert, Box, Button, Chip, Dialog, DialogContent, FormControl, InputLabel, MenuItem, Paper, Select, Stack, TextField, Typography, alpha } from '@mui/material'
import type { SelectChangeEvent } from '@mui/material/Select'
import type { BookmarkData, BookmarkFormState, BookmarkGroup, BookmarkItem, ConfirmState, DataDirStatus, GroupFormState } from '../types'
import { DEFAULT_GROUP_ID, groupName, isDataDirBroken, sortedGroups } from '../utils'

export function BookmarkDialog(props: {
  busy: boolean
  data: BookmarkData
  editing: BookmarkItem | null
  form: BookmarkFormState
  open: boolean
  onChange(form: BookmarkFormState): void
  onClose(): void
  onInferIcon(): void
  onSave(): void
}): React.ReactNode {
  const groups = sortedGroups(props.data.groups)
  return (
    <Dialog open={props.open} onClose={props.onClose} fullWidth maxWidth="sm">
      <DialogContent sx={{ p: 3 }}>
        <Stack spacing={2.25}>
          <Box>
            <Typography variant="h2">{props.editing ? '编辑收藏' : '添加收藏'}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>保存常用网站，之后可以一键打开。</Typography>
          </Box>
          <TextField label="标题" value={props.form.title} onChange={event => props.onChange({ ...props.form, title: event.target.value })} placeholder="例如：GitHub" autoFocus fullWidth />
          <TextField label="URL" value={props.form.url} onChange={event => props.onChange({ ...props.form, url: event.target.value })} placeholder="https://example.com" fullWidth />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} alignItems={{ xs: 'stretch', sm: 'center' }}>
            <TextField label="图标 URL" value={props.form.iconUrl} onChange={event => props.onChange({ ...props.form, iconUrl: event.target.value })} placeholder="自动推断 favicon" fullWidth />
            <Button variant="text" startIcon={<LanguageRoundedIcon />} onClick={props.onInferIcon} disabled={props.busy} sx={{ minWidth: 112 }}>推断图标</Button>
          </Stack>
          <FormControl variant="filled" size="small" fullWidth>
            <InputLabel id="bookmark-form-group-label">分组</InputLabel>
            <Select variant="filled" labelId="bookmark-form-group-label" label="分组" value={props.form.groupId} onChange={(event: SelectChangeEvent) => props.onChange({ ...props.form, groupId: event.target.value })}>
              {groups.map(group => <MenuItem key={group.id} value={group.id}>{group.name}</MenuItem>)}
            </Select>
          </FormControl>
          <Typography variant="caption" color="text.secondary">图标布局会自动吸附格子；右键或点更多菜单可打开、编辑、刷新图标或删除。</Typography>
          <Stack direction="row" spacing={1} justifyContent="flex-end">
            <Button onClick={props.onClose}>取消</Button>
            <Button variant="contained" onClick={props.onSave} disabled={props.busy}>{props.editing ? '保存' : '添加'}</Button>
          </Stack>
        </Stack>
      </DialogContent>
    </Dialog>
  )
}

export function GroupDialog(props: {
  busy: boolean
  data: BookmarkData
  editableGroups: BookmarkGroup[]
  form: GroupFormState
  open: boolean
  onChange(form: GroupFormState): void
  onClose(): void
  onDelete(group: BookmarkGroup): void
  onNew(): void
  onSave(): void
}): React.ReactNode {
  const selected = props.editableGroups.find(group => group.id === props.form.id)
  return (
    <Dialog open={props.open} onClose={props.onClose} fullWidth maxWidth="sm">
      <DialogContent sx={{ p: 3 }}>
        <Stack spacing={2.25}>
          <Box>
            <Typography variant="h2">{props.form.id ? '编辑分组' : '创建分组'}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>用分组把常用网站按场景收纳。</Typography>
          </Box>
          <TextField label="分组名称" value={props.form.name} onChange={event => props.onChange({ ...props.form, name: event.target.value })} placeholder="例如：工作" autoFocus fullWidth />
          {props.editableGroups.length ? (
            <Stack spacing={1}>
              <Typography variant="caption" color="text.secondary">已有分组</Typography>
              <Stack spacing={1} sx={{ maxHeight: 240, overflow: 'auto' }}>
                {props.editableGroups.map(group => (
                  <Button key={group.id} variant={group.id === props.form.id ? 'contained' : 'text'} onClick={() => props.onChange({ id: group.id, name: group.name })} sx={{ justifyContent: 'space-between', bgcolor: group.id === props.form.id ? undefined : theme => alpha(theme.palette.primary.main, 0.06) }}>
                    <span>{group.name}</span>
                    <Chip size="small" label={`${props.data.items.filter(item => item.groupId === group.id).length} 个收藏`} />
                  </Button>
                ))}
              </Stack>
            </Stack>
          ) : null}
          <Stack direction="row" spacing={1} justifyContent="flex-end" flexWrap="wrap">
            {selected ? <Button color="error" startIcon={<DeleteOutlineRoundedIcon />} onClick={() => props.onDelete(selected)} disabled={props.busy}>删除分组</Button> : null}
            <Box sx={{ flex: 1 }} />
            <Button onClick={props.onNew}>新建</Button>
            <Button variant="contained" onClick={props.onSave} disabled={props.busy}>保存</Button>
          </Stack>
        </Stack>
      </DialogContent>
    </Dialog>
  )
}

export function SettingsDialog(props: {
  busy: boolean
  error: string | null
  open: boolean
  status: DataDirStatus | null
  onClose(): void
  onPickDataDir(): void
  onReload(): void
}): React.ReactNode {
  const hasIssue = isDataDirBroken(props.status, props.error)
  return (
    <Dialog open={props.open} onClose={props.onClose} fullWidth maxWidth="md">
      <DialogContent sx={{ p: 3 }}>
        <Stack spacing={2.25}>
          <Box>
            <Typography variant="h2">设置</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>管理数据目录和后台连接状态。</Typography>
          </Box>
          <Paper elevation={0} sx={{ p: 2, borderRadius: 3, bgcolor: theme => alpha(hasIssue ? theme.palette.error.main : theme.palette.primary.main, 0.06), border: theme => `1px solid ${alpha(hasIssue ? theme.palette.error.main : theme.palette.primary.main, 0.16)}` }}>
            <Stack spacing={1.25}>
              <Typography fontWeight={900}>数据目录</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ wordBreak: 'break-all' }}>{props.status?.dataDir || '未就绪'}</Typography>
              {props.status?.error || props.error ? <Alert severity="error">{props.status?.error || props.error}</Alert> : null}
              <Stack direction="row" spacing={1} justifyContent="flex-end" flexWrap="wrap">
                <Button onClick={props.onReload} disabled={props.busy}>重新加载</Button>
                <Button variant="contained" onClick={props.onPickDataDir} disabled={props.busy}>选择数据目录</Button>
              </Stack>
            </Stack>
          </Paper>
          <Stack direction="row" justifyContent="flex-end"><Button onClick={props.onClose}>关闭</Button></Stack>
        </Stack>
      </DialogContent>
    </Dialog>
  )
}

export function ConfirmDialog(props: { busy: boolean; confirm: ConfirmState; data: BookmarkData; onClose(): void; onConfirm(): void }): React.ReactNode {
  const open = Boolean(props.confirm)
  const title = props.confirm?.kind === 'group' ? '删除分组' : '删除收藏'
  const description = props.confirm?.kind === 'group'
    ? `删除「${props.confirm.label}」后，此分组里的收藏会移动到「${groupName(props.data.groups, DEFAULT_GROUP_ID)}」。`
    : `确定删除「${props.confirm?.label || ''}」吗？`
  return (
    <Dialog open={open} onClose={props.onClose} fullWidth maxWidth="xs">
      <DialogContent sx={{ p: 3 }}>
        <Stack spacing={2}>
          <Box>
            <Typography variant="h2">{title}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{description}</Typography>
          </Box>
          <Stack direction="row" spacing={1} justifyContent="flex-end">
            <Button onClick={props.onClose}>取消</Button>
            <Button color="error" variant="contained" onClick={props.onConfirm} disabled={props.busy}>删除</Button>
          </Stack>
        </Stack>
      </DialogContent>
    </Dialog>
  )
}
