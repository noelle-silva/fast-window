import { Avatar, Box, Button, IconButton, Stack, TextField, Typography } from '@mui/material'
import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded'
import type { RegisteredAppShortcut } from './types'
import { generateSafeId } from './ids'
import { isDataImageUrl } from '../utils'
import type { IconImageSource } from '../iconImageInput'
import { hostButtonSx, hostTextFieldSx } from '../components/hostUiStyles'

interface AppCommandEditorProps {
  commands: RegisteredAppShortcut[]
  appIcon: string
  appName: string
  disabled?: boolean
  changingCommandIconId?: string | null
  onChange: (commands: RegisteredAppShortcut[]) => void
  onChangeIcon: (commandId: string, source: IconImageSource) => void
  onResetIcon: (commandId: string) => void
  recordingCommandId?: string | null
  onStartHotkeyRecording: (commandId: string) => void
  onClearHotkey: (commandId: string) => void
}

function commandIconDisplay(command: RegisteredAppShortcut, appIcon: string): string {
  return command.icon || appIcon || command.title[0] || 'C'
}

function uniqueCommandId(title: string, commands: RegisteredAppShortcut[]) {
  const base = generateSafeId(title, 'command')
  const used = new Set(commands.map(command => command.id))
  if (!used.has(base)) return base

  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base}-${index}`
    if (!used.has(candidate)) return candidate
  }
  return `${base}-${Date.now()}`
}

export default function AppCommandEditor({
  commands,
  appIcon,
  appName,
  disabled = false,
  changingCommandIconId = null,
  onChange,
  onChangeIcon,
  onResetIcon,
  recordingCommandId = null,
  onStartHotkeyRecording,
  onClearHotkey,
}: AppCommandEditorProps) {
  const updateCommandTitle = (id: string, nextTitle: string) => {
    onChange(commands.map(command => command.id === id ? { ...command, title: nextTitle } : command))
  }

  const updateCommandId = (id: string, nextId: string) => {
    const siblings = commands.filter(command => command.id !== id)
    const safeId = uniqueCommandId(nextId, siblings)
    onChange(commands.map(command => command.id === id ? { ...command, id: safeId } : command))
  }

  const removeCommand = (id: string) => {
    onChange(commands.filter(command => command.id !== id))
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
          快捷入口
        </Typography>
        <Typography variant="caption" color="text.secondary">
          快捷入口会出现在主页搜索列表里，用于快速打开应用内部页面或动作。这里不展示应用能力。
        </Typography>
      </Box>

      {commands.length ? (
        <Stack spacing={1}>
          {commands.map(command => {
            const displayIcon = commandIconDisplay(command, appIcon)
            const iconAsImage = isDataImageUrl(displayIcon) ? displayIcon : undefined
            const iconChanging = changingCommandIconId === command.id

            return (
              <Box key={command.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Avatar
                  variant="rounded"
                  src={iconAsImage}
                  imgProps={{ alt: `${command.title || appName || '命令'} 图标预览` }}
                  sx={{ width: 36, height: 36, fontSize: 17, bgcolor: 'action.hover', color: 'text.primary', flexShrink: 0 }}
                >
                  {iconAsImage ? null : displayIcon}
                </Avatar>
                <TextField
                  label="命令名称"
                  value={command.title}
                  onChange={event => updateCommandTitle(command.id, event.target.value)}
                  size="small"
                  sx={{ ...hostTextFieldSx, flex: '1 1 220px' }}
                />
                <TextField
                  label="命令 ID"
                  value={command.id}
                  onChange={event => updateCommandId(command.id, event.target.value)}
                  size="small"
                  sx={{ ...hostTextFieldSx, width: 150, flexShrink: 0 }}
                />
                <TextField
                  label="命令快捷键"
                  value={command.hotkey || ''}
                  size="small"
                  placeholder="未绑定"
                  InputProps={{ readOnly: true }}
                  sx={{ ...hostTextFieldSx, width: 190, flexShrink: 0 }}
                />
                <Button
                  variant={recordingCommandId === command.id ? 'contained' : 'text'}
                  color={recordingCommandId === command.id ? 'warning' : 'primary'}
                  onClick={() => onStartHotkeyRecording(command.id)}
                  sx={{ ...hostButtonSx, flexShrink: 0 }}
                >
                  {recordingCommandId === command.id ? '录制中…' : '录制'}
                </Button>
                <Button variant="text" onClick={() => onClearHotkey(command.id)} sx={{ ...hostButtonSx, flexShrink: 0 }}>
                  清空
                </Button>
                <Button
                  variant="text"
                  disabled={disabled || iconChanging}
                  onClick={() => onChangeIcon(command.id, 'file')}
                  sx={{ ...hostButtonSx, flexShrink: 0 }}
                >
                  {iconChanging ? '更新中…' : '选图标'}
                </Button>
                <Button
                  variant="text"
                  disabled={disabled || iconChanging}
                  onClick={() => onChangeIcon(command.id, 'clipboard')}
                  sx={{ ...hostButtonSx, flexShrink: 0 }}
                >
                  粘贴图标
                </Button>
                <Button
                  variant="text"
                  disabled={disabled || iconChanging || !command.icon}
                  onClick={() => onResetIcon(command.id)}
                  sx={{ ...hostButtonSx, flexShrink: 0 }}
                >
                  跟随主页
                </Button>
                <IconButton size="small" aria-label={`删除命令 ${command.title}`} onClick={() => removeCommand(command.id)}>
                  <DeleteRoundedIcon fontSize="small" />
                </IconButton>
              </Box>
            )
          })}
        </Stack>
      ) : (
        <Typography variant="caption" color="text.secondary">
          这个应用包没有声明快捷入口。
        </Typography>
      )}
    </Box>
  )
}
