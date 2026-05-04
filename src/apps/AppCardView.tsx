import { Box, Avatar, Typography, Chip } from '@mui/material'
import type { RegisteredApp, AppStatus } from './types'

interface AppCardViewProps {
  app: RegisteredApp
  status?: AppStatus
  showStatus?: boolean
  selected?: boolean
  onClick?: () => void
  onContextMenu?: (e: React.MouseEvent) => void
}

export default function AppCardView({ app, status, showStatus, selected, onClick, onContextMenu }: AppCardViewProps) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!onClick) return
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    onClick()
  }

  return (
    <Box
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={onClick ? `编辑 ${app.name}` : undefined}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onKeyDown={handleKeyDown}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        p: 1.25,
        borderRadius: 2,
        cursor: onClick ? 'pointer' : 'default',
        bgcolor: selected ? 'action.selected' : 'transparent',
        '&:hover': { bgcolor: onClick ? 'action.hover' : selected ? 'action.selected' : 'transparent' },
        '&:focus-visible': {
          outline: onClick ? '2px solid' : 'none',
          outlineColor: 'primary.main',
          outlineOffset: 2,
        },
      }}
    >
      <Avatar
        variant="rounded"
        src={app.icon}
        sx={{ width: 36, height: 36, fontSize: 18, bgcolor: 'action.hover' }}
      >
        {app.icon ? null : app.name[0]}
      </Avatar>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="body2" fontWeight={700} noWrap>
          {app.name}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25 }}>
          {showStatus ? (
            status?.running ? (
              <Chip label="运行中" size="small" color="success" sx={{ height: 18, fontSize: 10 }} />
            ) : (
              <Chip label="未运行" size="small" variant="outlined" sx={{ height: 18, fontSize: 10 }} />
            )
          ) : null}
          {app.hotkey ? (
            <Typography variant="caption" color="text.secondary">
              {app.hotkey}
            </Typography>
          ) : null}
        </Box>
      </Box>
    </Box>
  )
}
