import { useState } from 'react'
import {
  Box, Typography, IconButton, Button,
  Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, ToggleButtonGroup, ToggleButton,
} from '@mui/material'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded'
import type { AppDisplayMode, RegisteredApp } from './types'
import AppCardView from './AppCardView'

interface AppRegistrationPanelProps {
  apps: RegisteredApp[]
  onAdd: (app: RegisteredApp) => void
  onRemove: (id: string) => void
  onUpdate: (id: string, patch: Partial<RegisteredApp>) => void
  onClose: () => void
}

function generateId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32) || 'untitled'
}

export default function AppRegistrationPanel({ apps, onAdd, onRemove, onUpdate, onClose }: AppRegistrationPanelProps) {
  const [editOpen, setEditOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const [hotkey, setHotkey] = useState('')
  const [displayMode, setDisplayMode] = useState<AppDisplayMode>('default')

  const openAdd = () => {
    setEditingId(null)
    setName('')
    setPath('')
    setHotkey('')
    setDisplayMode('default')
    setEditOpen(true)
  }

  const save = () => {
    const n = name.trim()
    const p = path.trim()
    if (!n || !p) return

    const id = editingId ?? generateId(n)

    if (editingId) {
      onUpdate(editingId, { name: n, path: p, hotkey: hotkey.trim() || undefined, displayMode })
    } else {
      onAdd({
        id,
        name: n,
        icon: '',
        path: p,
        hotkey: hotkey.trim() || undefined,
        displayMode,
        commands: [],
        autoStart: false,
      })
    }
    setEditOpen(false)
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ pr: 6 }}>
        注册管理
        <IconButton aria-label="关闭" onClick={onClose} sx={{ position: 'absolute', right: 8, top: 8 }} size="small">
          <CloseRoundedIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        {apps.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
            暂无注册应用
          </Typography>
        ) : (
          apps.map(app => (
            <Box key={app.id} sx={{ display: 'flex', alignItems: 'center' }}>
              <Box sx={{ flex: 1 }}>
                <AppCardView app={app} />
              </Box>
              <IconButton
                size="small"
                onClick={() => onRemove(app.id)}
                aria-label={`移除 ${app.name}`}
              >
                <DeleteRoundedIcon fontSize="small" />
              </IconButton>
            </Box>
          ))
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={openAdd} variant="contained" size="small" sx={{ boxShadow: 'none' }}>
          添加应用
        </Button>
      </DialogActions>

      <Dialog open={editOpen} onClose={() => setEditOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>{editingId ? '编辑应用' : '添加应用'}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
          <TextField label="名称" value={name} onChange={e => setName(e.target.value)} size="small" fullWidth />
          <TextField label="可执行文件路径" value={path} onChange={e => setPath(e.target.value)} size="small" fullWidth placeholder="C:\Apps\my-app\app.exe" />
          <TextField label="快捷键（可选）" value={hotkey} onChange={e => setHotkey(e.target.value)} size="small" fullWidth placeholder="Alt+Space H" />
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>显示模式</Typography>
            <ToggleButtonGroup
              value={displayMode}
              exclusive
              onChange={(_, v) => v && setDisplayMode(v)}
              size="small"
            >
              <ToggleButton value="default">默认</ToggleButton>
              <ToggleButton value="window">窗口</ToggleButton>
              <ToggleButton value="top">置顶</ToggleButton>
            </ToggleButtonGroup>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditOpen(false)}>取消</Button>
          <Button onClick={save} variant="contained" sx={{ boxShadow: 'none' }}>保存</Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  )
}
