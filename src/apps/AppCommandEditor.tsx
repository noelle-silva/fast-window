import { useState } from 'react'
import { Avatar, Box, Button, IconButton, MenuItem, Select, Stack, TextField, Typography } from '@mui/material'
import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded'
import type { RegisteredAppCommand } from './types'
import { generateSafeId } from './ids'
import { isDataImageUrl } from '../utils'
import type { IconImageSource } from '../iconImageInput'
import { hostButtonSx, hostSelectSx, hostTextFieldSx } from '../components/hostUiStyles'

interface AppCommandEditorProps {
  commands: RegisteredAppCommand[]
  currentCommands?: RegisteredAppCommand[]
  appIcon: string
  appName: string
  disabled?: boolean
  changingCommandIconId?: string | null
  onChange: (commands: RegisteredAppCommand[]) => void
  onChangeIcon: (commandId: string, source: IconImageSource) => void
  onResetIcon: (commandId: string) => void
  recordingCommandId?: string | null
  onStartHotkeyRecording: (commandId: string) => void
  onClearHotkey: (commandId: string) => void
}

function commandIconDisplay(command: RegisteredAppCommand, appIcon: string): string {
  return command.icon || appIcon || command.title[0] || 'C'
}

function uniqueCommandId(title: string, commands: RegisteredAppCommand[]) {
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
  currentCommands = [],
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
  const [title, setTitle] = useState('')
  const [selectedCommandId, setSelectedCommandId] = useState('')

  const selectableCommands = currentCommands.filter(command => !commands.some(item => item.id === command.id))
  const commandSelectPlaceholder = currentCommands.length
    ? selectableCommands.length
      ? '选择 App 当前返回的命令'
      : 'App 当前返回的命令已全部添加'
    : '尚未读取到 App 当前命令'

  const addCommand = () => {
    const nextTitle = title.trim()
    if (!nextTitle) return
    onChange(commands.concat({ id: uniqueCommandId(nextTitle, commands), title: nextTitle }))
    setTitle('')
  }

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

  const addSelectedCommand = () => {
    const command = selectableCommands.find(item => item.id === selectedCommandId)
    if (!command) return
    onChange(commands.concat({ ...command }))
    setSelectedCommandId('')
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
          应用命令
        </Typography>
        <Typography variant="caption" color="text.secondary">
          命令会出现在主搜索列表里。每条命令可以设置独立图标；未设置时跟随主页图标。
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Select
          value={selectedCommandId}
          onChange={event => setSelectedCommandId(event.target.value)}
          displayEmpty
          disabled={!selectableCommands.length}
          size="small"
          fullWidth
          sx={hostSelectSx}
        >
          <MenuItem value="">{commandSelectPlaceholder}</MenuItem>
          {selectableCommands.map(command => (
            <MenuItem key={command.id} value={command.id}>{command.title}（{command.id}）</MenuItem>
          ))}
        </Select>
        <Button variant="text" disabled={!selectedCommandId} onClick={addSelectedCommand} sx={{ ...hostButtonSx, flexShrink: 0 }}>
          添加
        </Button>
      </Box>
      <Typography variant="caption" color="text.secondary">
        这里读取 App 当前回答的命令；如果暂时读不到，仍可手动添加。
      </Typography>

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
          暂无命令。
        </Typography>
      )}

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <TextField
          label="新命令名称"
          value={title}
          onChange={event => setTitle(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault()
              addCommand()
            }
          }}
          size="small"
          fullWidth
          placeholder="例如：新增收藏"
          sx={hostTextFieldSx}
        />
        <Button variant="text" onClick={addCommand} sx={{ ...hostButtonSx, flexShrink: 0 }}>
          添加
        </Button>
      </Box>
    </Box>
  )
}
