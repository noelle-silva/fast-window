import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined'
import DragIndicatorOutlinedIcon from '@mui/icons-material/DragIndicatorOutlined'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import { Box, Button, Chip, IconButton, Tooltip, Typography } from '@mui/material'
import type { DraggableAttributes } from '@dnd-kit/core'
import { closeModeLabel, resolveCloseMode, resolveCountdownSeconds, resolveShellInfo, shellTierLabel } from '../shellResolve'
import type { AppSettings, CommandItem, Repo, ShellInfo } from '../types'

type DragHandle = {
  attributes: DraggableAttributes
  listeners: Record<string, Function> | undefined
}

type CommandCardProps = {
  command: CommandItem
  repo: Repo
  settings: AppSettings | null
  shells: ShellInfo[]
  dragHandle?: DragHandle
  disabled?: boolean
  onRun: () => void
  onEdit: () => void
  onDelete: () => void
}

export function CommandCard({ command, repo, settings, shells, dragHandle, disabled = false, onRun, onEdit, onDelete }: CommandCardProps) {
  const shell = resolveShellInfo(command.shellId, repo.shellId, settings, shells)
  const closeMode = resolveCloseMode(command, settings)
  const countdownSeconds = resolveCountdownSeconds(command, settings)

  return (
    <Box className="cr-command-card">
      <Box className="cr-command-card-content">
        {dragHandle ? (
          <Box
            className="cr-drag-handle"
            aria-label="拖拽排序"
            {...dragHandle.attributes}
            {...dragHandle.listeners}
          >
            <DragIndicatorOutlinedIcon fontSize="small" />
          </Box>
        ) : null}
        <Box className="cr-command-card-body">
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
            <Typography component="h3" sx={{ minWidth: 0, fontSize: 14, fontWeight: 900 }} noWrap>{command.name}</Typography>
            {command.confirmBeforeRun ? (
              <Chip size="small" color="warning" variant="outlined" label="需二次确认" sx={{ fontWeight: 800, fontSize: 11, height: 20 }} />
            ) : null}
          </Box>
          {command.note ? (
            <Typography color="text.secondary" sx={{ fontSize: 12, lineHeight: 1.5 }}>{command.note}</Typography>
          ) : null}
          <pre className="cr-command-script">{command.script}</pre>
          <Box className="cr-command-meta">
            <Chip size="small" label={`终端: ${shell ? shell.name : '未知'}`} sx={{ fontWeight: 700, fontSize: 11, height: 22, bgcolor: 'background.paper' }} />
            <Chip size="small" label={`终端来源: ${shellTierLabel(command.shellId, repo.shellId)}`} sx={{ fontWeight: 700, fontSize: 11, height: 22, bgcolor: 'background.paper' }} />
            <Chip size="small" label={closeModeLabel(closeMode, countdownSeconds)} sx={{ fontWeight: 700, fontSize: 11, height: 22, bgcolor: 'background.paper' }} />
          </Box>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Tooltip title="运行命令">
            <span>
              <Button
                size="small"
                variant="contained"
                startIcon={<PlayArrowIcon fontSize="small" />}
                disabled={disabled}
                onClick={onRun}
              >
                运行
              </Button>
            </span>
          </Tooltip>
          <IconButton size="small" aria-label="编辑命令" disabled={disabled} onClick={onEdit}>
            <EditOutlinedIcon fontSize="small" />
          </IconButton>
          <IconButton size="small" aria-label="删除命令" disabled={disabled} onClick={onDelete}>
            <DeleteOutlineOutlinedIcon fontSize="small" />
          </IconButton>
        </Box>
      </Box>
    </Box>
  )
}
