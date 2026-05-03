import { useState } from 'react'
import { Box, Button, IconButton, Stack, TextField, Typography } from '@mui/material'
import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded'
import type { RegisteredAppCommand } from './types'
import { generateSafeId } from './ids'

interface AppCommandEditorProps {
  commands: RegisteredAppCommand[]
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

export default function AppCommandEditor({ commands, onChange }: AppCommandEditorProps) {
  const [title, setTitle] = useState('')

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

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
          应用命令
        </Typography>
        <Typography variant="caption" color="text.secondary">
          命令会出现在主搜索列表里，触发后以 --fw-command 传给 App。
        </Typography>
      </Box>

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
