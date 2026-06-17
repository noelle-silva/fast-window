import { Avatar, Box, Button, IconButton, Stack, TextField, Typography } from '@mui/material'
import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded'
import type { RegisteredAppShortcut } from './types'
import { generateSafeId } from './ids'
import { isDataImageUrl } from '../utils'
import type { IconImageSource } from '../iconImageInput'
import { hostButtonSx, hostTextFieldSx } from '../components/hostUiStyles'

interface AppHostShortcutEditorProps {
  shortcuts: RegisteredAppShortcut[]
  appIcon: string
  appName: string
  disabled?: boolean
  changingShortcutIconId?: string | null
  readingHostShortcuts?: boolean
  canReadHostShortcuts?: boolean
  onChange: (shortcuts: RegisteredAppShortcut[]) => void
  onChangeIcon: (shortcutId: string, source: IconImageSource) => void
  onResetIcon: (shortcutId: string) => void
  onReadHostShortcuts: () => void
  recordingShortcutId?: string | null
  onStartHotkeyRecording: (shortcutId: string) => void
  onClearHotkey: (shortcutId: string) => void
}

function shortcutIconDisplay(shortcut: RegisteredAppShortcut, appIcon: string): string {
  return shortcut.icon || appIcon || shortcut.title[0] || 'S'
}

function uniqueShortcutId(title: string, shortcuts: RegisteredAppShortcut[]) {
  const base = generateSafeId(title, 'shortcut')
  const used = new Set(shortcuts.map(shortcut => shortcut.id))
  if (!used.has(base)) return base

  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base}-${index}`
    if (!used.has(candidate)) return candidate
  }
  return `${base}-${Date.now()}`
}

export default function AppHostShortcutEditor({
  shortcuts,
  appIcon,
  appName,
  disabled = false,
  changingShortcutIconId = null,
  readingHostShortcuts = false,
  canReadHostShortcuts = true,
  onChange,
  onChangeIcon,
  onResetIcon,
  onReadHostShortcuts,
  recordingShortcutId = null,
  onStartHotkeyRecording,
  onClearHotkey,
}: AppHostShortcutEditorProps) {
  const updateShortcutTitle = (id: string, nextTitle: string) => {
    onChange(shortcuts.map(shortcut => shortcut.id === id ? { ...shortcut, title: nextTitle } : shortcut))
  }

  const updateShortcutId = (id: string, nextId: string) => {
    const siblings = shortcuts.filter(shortcut => shortcut.id !== id)
    const safeId = uniqueShortcutId(nextId, siblings)
    onChange(shortcuts.map(shortcut => shortcut.id === id ? { ...shortcut, id: safeId } : shortcut))
  }

  const removeShortcut = (id: string) => {
    onChange(shortcuts.filter(shortcut => shortcut.id !== id))
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
            宿主快捷命令
          </Typography>
          <Typography variant="caption" color="text.secondary">
            宿主快捷命令会出现在主页搜索列表里，用于快速打开应用内部页面或动作。这里不展示 App 能力 API。
          </Typography>
        </Box>
        <Button
          variant="text"
          disabled={disabled || readingHostShortcuts || !canReadHostShortcuts}
          onClick={onReadHostShortcuts}
          sx={{ ...hostButtonSx, flexShrink: 0 }}
        >
          {readingHostShortcuts ? '读取中…' : '读取宿主快捷命令'}
        </Button>
      </Box>

      {shortcuts.length ? (
        <Stack spacing={1}>
          {shortcuts.map(shortcut => {
            const displayIcon = shortcutIconDisplay(shortcut, appIcon)
            const iconAsImage = isDataImageUrl(displayIcon) ? displayIcon : undefined
            const iconChanging = changingShortcutIconId === shortcut.id

            return (
              <Box key={shortcut.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Avatar
                  variant="rounded"
                  src={iconAsImage}
                  imgProps={{ alt: `${shortcut.title || appName || '宿主快捷命令'} 图标预览` }}
                  sx={{ width: 36, height: 36, fontSize: 17, bgcolor: 'action.hover', color: 'text.primary', flexShrink: 0 }}
                >
                  {iconAsImage ? null : displayIcon}
                </Avatar>
                <TextField
                  label="快捷命令名称"
                  value={shortcut.title}
                  onChange={event => updateShortcutTitle(shortcut.id, event.target.value)}
                  size="small"
                  sx={{ ...hostTextFieldSx, flex: '1 1 220px' }}
                />
                <TextField
                  label="快捷命令 ID"
                  value={shortcut.id}
                  onChange={event => updateShortcutId(shortcut.id, event.target.value)}
                  size="small"
                  sx={{ ...hostTextFieldSx, width: 150, flexShrink: 0 }}
                />
                <TextField
                  label="快捷命令快捷键"
                  value={shortcut.hotkey || ''}
                  size="small"
                  placeholder="未绑定"
                  InputProps={{ readOnly: true }}
                  sx={{ ...hostTextFieldSx, width: 190, flexShrink: 0 }}
                />
                <Button
                  variant={recordingShortcutId === shortcut.id ? 'contained' : 'text'}
                  color={recordingShortcutId === shortcut.id ? 'warning' : 'primary'}
                  onClick={() => onStartHotkeyRecording(shortcut.id)}
                  sx={{ ...hostButtonSx, flexShrink: 0 }}
                >
                  {recordingShortcutId === shortcut.id ? '录制中…' : '录制'}
                </Button>
                <Button variant="text" onClick={() => onClearHotkey(shortcut.id)} sx={{ ...hostButtonSx, flexShrink: 0 }}>
                  清空
                </Button>
                <Button
                  variant="text"
                  disabled={disabled || iconChanging}
                  onClick={() => onChangeIcon(shortcut.id, 'file')}
                  sx={{ ...hostButtonSx, flexShrink: 0 }}
                >
                  {iconChanging ? '更新中…' : '选图标'}
                </Button>
                <Button
                  variant="text"
                  disabled={disabled || iconChanging}
                  onClick={() => onChangeIcon(shortcut.id, 'clipboard')}
                  sx={{ ...hostButtonSx, flexShrink: 0 }}
                >
                  粘贴图标
                </Button>
                <Button
                  variant="text"
                  disabled={disabled || iconChanging || !shortcut.icon}
                  onClick={() => onResetIcon(shortcut.id)}
                  sx={{ ...hostButtonSx, flexShrink: 0 }}
                >
                  跟随主页
                </Button>
                <IconButton size="small" aria-label={`删除宿主快捷命令 ${shortcut.title}`} onClick={() => removeShortcut(shortcut.id)}>
                  <DeleteRoundedIcon fontSize="small" />
                </IconButton>
              </Box>
            )
          })}
        </Stack>
      ) : (
        <Typography variant="caption" color="text.secondary">
          暂未登记宿主快捷命令。可以点击“读取宿主快捷命令”从 App 获取。
        </Typography>
      )}
    </Box>
  )
}
