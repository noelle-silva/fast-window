import { useState } from 'react'
import { Box, Button, IconButton, MenuItem, Select, Stack, TextField, Typography } from '@mui/material'
import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded'
import type { RegisteredAppCommand } from './types'
import { generateSafeId } from './ids'

interface AppCommandEditorProps {
  commands: RegisteredAppCommand[]
  availableCommands?: RegisteredAppCommand[]
  onChange: (commands: RegisteredAppCommand[]) => void
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

export default function AppCommandEditor({ commands, availableCommands = [], onChange }: AppCommandEditorProps) {
  const [title, setTitle] = useState('')
  const [selectedCommandId, setSelectedCommandId] = useState('')

  const selectableCommands = availableCommands.filter(command => !commands.some(item => item.id === command.id))
  const commandSelectPlaceholder = availableCommands.length
    ? selectableCommands.length
      ? '选择 App 上报的命令'
      : 'App 上报的命令已全部添加'
    : '尚未收到 App 上报的命令'

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
    onChange(commands.concat({ id: command.id, title: command.title }))
    setSelectedCommandId('')
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
          应用命令
        </Typography>
        <Typography variant="caption" color="text.secondary">
          命令会出现在主搜索列表里。优先从 App 上报的可用命令中选择，必要时也可以手动添加。
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
        >
          <MenuItem value="">{commandSelectPlaceholder}</MenuItem>
          {selectableCommands.map(command => (
            <MenuItem key={command.id} value={command.id}>{command.title}（{command.id}）</MenuItem>
          ))}
        </Select>
        <Button variant="outlined" disabled={!selectedCommandId} onClick={addSelectedCommand} sx={{ flexShrink: 0 }}>
          添加
        </Button>
      </Box>
      <Typography variant="caption" color="text.secondary">
        App 启动后会自动上报可选命令；未上报前仍可手动添加。
      </Typography>

      {commands.length ? (
        <Stack spacing={1}>
          {commands.map(command => (
            <Box key={command.id} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <TextField
                label="命令名称"
                value={command.title}
                onChange={event => updateCommandTitle(command.id, event.target.value)}
                size="small"
                fullWidth
              />
              <TextField
                label="命令 ID"
                value={command.id}
                onChange={event => updateCommandId(command.id, event.target.value)}
                size="small"
                sx={{ width: 150, flexShrink: 0 }}
                helperText="传给 App"
              />
              <IconButton size="small" aria-label={`删除命令 ${command.title}`} onClick={() => removeCommand(command.id)}>
                <DeleteRoundedIcon fontSize="small" />
              </IconButton>
            </Box>
          ))}
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
        />
        <Button variant="outlined" onClick={addCommand} sx={{ flexShrink: 0 }}>
          添加
        </Button>
      </Box>
    </Box>
  )
}
