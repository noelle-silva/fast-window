import * as React from 'react'
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Menu, MenuItem, Stack, TextField, Tooltip, Typography } from '@mui/material'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import SaveIcon from '@mui/icons-material/Save'
import type { PlaceholderFolder, PlaceholderItem } from '../../domain/placeholder'
import { SettingsPill, SettingsSection } from './SettingsSurfaces'

// 值输入区最低高度按原设定翻倍（行数 5 → 10），插件提示块保持同高。
const PLACEHOLDER_VALUE_MIN_ROWS = 10
const PLACEHOLDER_VALUE_BOX_MIN_HEIGHT = 232

function text(value: unknown) {
  return String(value ?? '').trim()
}

export function formatPlaceholderTime(value: unknown) {
  const raw = text(value)
  if (!raw) return '未知时间'
  const time = Date.parse(raw)
  if (!isFinite(time)) return raw
  return new Date(time).toLocaleString('zh-CN')
}

type PlaceholderEditorProps = {
  item: PlaceholderItem
  folders: PlaceholderFolder[]
  disabled: boolean
  saving: boolean
  sourcePluginDisabled: boolean
  dirty?: boolean
  onRename: (name: string) => void
  onUpdate: (patch: Partial<PlaceholderItem>) => void
  onSave: () => void
  onDelete: () => void
}

export function PlaceholderEditor(props: PlaceholderEditorProps) {
  const { item, folders, disabled, saving, sourcePluginDisabled, dirty, onRename, onUpdate, onSave, onDelete } = props
  const [menuEl, setMenuEl] = React.useState<HTMLElement | null>(null)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = React.useState(false)
  const label = text(item.name) || '未命名占位符'
  const memberFolders = folders.filter((folder) => !!folder.placeholderNames?.includes(item.name))
  return (
    <SettingsSection>
      <Stack spacing={1}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
          <TextField size="small" label="名字" value={item.name} onChange={(e) => onRename(e.target.value)} sx={{ flex: 1 }} disabled={disabled} />
          <Box sx={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
            <Button startIcon={<SaveIcon />} variant="contained" size="small" onClick={onSave} disabled={disabled || !text(item.name)}>{saving ? '保存中…' : '保存'}</Button>
            {dirty ? (
              <Tooltip title="有未保存的修改">
                <Box sx={{ position: 'absolute', top: -3, right: -3, width: 8, height: 8, borderRadius: '50%', bgcolor: 'warning.main', boxShadow: '0 0 0 2px var(--studio-field)', pointerEvents: 'none' }} />
              </Tooltip>
            ) : null}
          </Box>
          <Tooltip title="更多操作">
            <span>
              <IconButton size="small" aria-label="更多操作" onClick={(event) => setMenuEl(event.currentTarget)} disabled={disabled}>
                <MoreVertIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
        <TextField size="small" label="备注" value={item.description || ''} onChange={(e) => onUpdate({ description: e.target.value })} disabled={disabled} fullWidth />
        {item.source?.kind === 'system_plugin' ? (
          <Stack spacing={0.5}>
            <Typography variant="caption" color="text.secondary">值</Typography>
            <Box
              sx={{
                borderRadius: 2,
                bgcolor: 'var(--studio-field)',
                boxShadow: 'var(--studio-shadow-soft)',
                px: 1.5,
                py: 1.25,
                minHeight: PLACEHOLDER_VALUE_BOX_MIN_HEIGHT,
                display: 'grid',
                placeItems: 'center',
              }}
            >
              <Typography variant="body2" sx={{ fontWeight: 700, textAlign: 'center', color: sourcePluginDisabled ? 'error.main' : 'primary.main' }}>
                {sourcePluginDisabled
                  ? '所属插件已停用：解析时会跳过这个占位符并提示，启用插件后自动恢复。'
                  : '这个占位符的值由系统插件动态提供，保存的手写值不会参与解析。'}
              </Typography>
            </Box>
          </Stack>
        ) : (
          <TextField size="small" multiline minRows={PLACEHOLDER_VALUE_MIN_ROWS} label="值" value={item.value} onChange={(e) => onUpdate({ value: e.target.value })} disabled={disabled} fullWidth />
        )}
        <Typography variant="caption" color="text.secondary">创建时间：{formatPlaceholderTime(item.createdAt)}</Typography>
        <Typography variant="body2" sx={{ fontWeight: 900 }}>所属收藏夹</Typography>
        {memberFolders.length ? (
          <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap' }}>
            {memberFolders.map((folder) => <SettingsPill key={folder.id}>{folder.name}</SettingsPill>)}
          </Stack>
        ) : <Typography variant="caption" color="text.secondary">这个占位符还没有加入收藏夹。</Typography>}

        <Menu anchorEl={menuEl} open={!!menuEl} onClose={() => setMenuEl(null)} transitionDuration={{ enter: 0, exit: 0 }}>
          <MenuItem
            sx={{ color: 'error.main', gap: 1 }}
            onClick={() => {
              setMenuEl(null)
              setConfirmDeleteOpen(true)
            }}
          >
            <DeleteOutlineIcon fontSize="small" />
            删除占位符
          </MenuItem>
        </Menu>

        <Dialog open={confirmDeleteOpen} onClose={() => setConfirmDeleteOpen(false)} maxWidth="xs" fullWidth PaperProps={{ sx: { bgcolor: 'var(--studio-paper-muted)' } }}>
          <DialogTitle>确认删除占位符？</DialogTitle>
          <DialogContent>
            <Typography variant="body2" color="text.secondary">将删除「{label}」，并从各收藏夹中移除。删除会立即生效。</Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setConfirmDeleteOpen(false)}>取消</Button>
            <Button
              color="error"
              variant="contained"
              onClick={() => {
                setConfirmDeleteOpen(false)
                onDelete()
              }}
            >
              删除
            </Button>
          </DialogActions>
        </Dialog>
      </Stack>
    </SettingsSection>
  )
}
