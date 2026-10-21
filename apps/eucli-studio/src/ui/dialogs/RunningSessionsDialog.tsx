import * as React from 'react'
import {
  Box,
  Chip,
  CircularProgress,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItemAvatar,
  ListItemButton,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline'
import type { RunningSessionEntry, RunningSessionStatusKey } from '../../domain/runningSessions'
import { DependableDialog } from '../components/DependableOverlay'
import { EntityAvatar } from '../components/avatar/EntityAvatar'
import { colorMixVar } from '../colorThemeStyles'
import { SOFT_POPOVER_ITEM_SX, SOFT_POPOVER_LIST_SX } from '../softPopoverStyles'

const TARGET_KIND_LABEL: Record<RunningSessionEntry['targetKind'], string> = {
  role: '角色',
  group: '群组',
  workspace: '工作区',
}

const STATUS_COLOR: Record<RunningSessionStatusKey, string> = {
  queued: 'text.secondary',
  running: 'primary.main',
  waiting_confirmation: 'warning.main',
  retrying: 'warning.main',
  active: 'text.secondary',
}

function RunStatus(props: { statusKey: RunningSessionStatusKey; statusLabel: string }) {
  const { statusKey, statusLabel } = props
  return (
    <Stack direction="row" alignItems="center" spacing={0.5} sx={{ flex: '0 0 auto' }}>
      {statusKey === 'running' ? (
        <CircularProgress size={11} thickness={5} sx={{ color: STATUS_COLOR[statusKey] }} />
      ) : (
        <Box
          component="span"
          sx={{
            width: 6,
            height: 6,
            borderRadius: 999,
            bgcolor: STATUS_COLOR[statusKey],
            opacity: statusKey === 'active' || statusKey === 'queued' ? 0.55 : 1,
          }}
        />
      )}
      <Typography variant="caption" sx={{ fontWeight: 900, color: STATUS_COLOR[statusKey], lineHeight: 1.2 }}>
        {statusLabel}
      </Typography>
    </Stack>
  )
}

export function RunningSessionsDialog(props: {
  open: boolean
  entries: RunningSessionEntry[]
  activeKey: string
  onClose: () => void
  onOpen: (entry: RunningSessionEntry) => void
}) {
  const { open, entries, activeKey, onClose, onOpen } = props

  return (
    <DependableDialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="md"
      PaperProps={{
        sx: {
          height: 'min(600px, 86vh)',
          display: 'flex',
          flexDirection: 'column',
          bgcolor: 'var(--studio-paper-muted)',
          backgroundImage: 'none',
          borderRadius: 3,
        },
      }}
    >
      <DialogTitle
        component="div"
        sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 1, flexShrink: 0 }}
      >
        <PlayCircleOutlineIcon fontSize="small" color="primary" />
        <Typography component="span" variant="subtitle1" sx={{ fontWeight: 900, flex: 1 }}>
          正在运行的会话
        </Typography>
        {entries.length ? (
          <Chip
            size="small"
            label={`${entries.length} 个`}
            sx={{ height: 22, fontWeight: 900, bgcolor: colorMixVar('--studio-primary', 10), color: 'primary.main' }}
          />
        ) : null}
        <IconButton size="small" onClick={onClose} aria-label="关闭运行中会话窗口">
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ p: 0, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {entries.length ? (
          <List
            dense
            sx={{
              ...SOFT_POPOVER_LIST_SX,
              py: 1,
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
            }}
          >
            {entries.map((entry) => (
              <ListItemButton
                key={entry.key}
                selected={entry.key === activeKey}
                onClick={() => onOpen(entry)}
                sx={{ ...SOFT_POPOVER_ITEM_SX, gap: 1.25, py: 1 }}
              >
                <ListItemAvatar sx={{ minWidth: 0, mr: 0, alignSelf: 'center' }}>
                  <EntityAvatar kind={entry.targetKind} image={entry.avatarImage} size={36} />
                </ListItemAvatar>
                <ListItemText
                  sx={{ minWidth: 0, my: 0 }}
                  primaryTypographyProps={{ component: 'div' }}
                  secondaryTypographyProps={{ component: 'div' }}
                  primary={
                    <Typography component="span" sx={{ fontWeight: 900, fontSize: 14, display: 'block' }} noWrap>
                      {entry.title}
                    </Typography>
                  }
                  secondary={
                    <Stack direction="row" alignItems="center" spacing={0.75} sx={{ minWidth: 0, mt: 0.25 }}>
                      <Typography variant="caption" color="text.secondary" noWrap sx={{ minWidth: 0 }}>
                        {TARGET_KIND_LABEL[entry.targetKind]} · {entry.targetName}
                      </Typography>
                      <Box component="span" sx={{ width: 3, height: 3, borderRadius: 999, bgcolor: 'text.disabled', flex: '0 0 3px' }} />
                      <RunStatus statusKey={entry.statusKey} statusLabel={entry.statusLabel} />
                    </Stack>
                  }
                />
              </ListItemButton>
            ))}
          </List>
        ) : (
          <Box
            sx={{
              flex: 1,
              minHeight: 0,
              px: 3,
              py: 6,
              textAlign: 'center',
              color: 'text.secondary',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <PlayCircleOutlineIcon sx={{ fontSize: 42, opacity: 0.32 }} />
            <Typography variant="body2" sx={{ mt: 1.5, fontWeight: 900, color: 'text.primary' }}>
              现在没有正在运行的会话。
            </Typography>
            <Typography variant="caption" color="text.secondary">
              新的回复开始生成后，会自动出现在这里。
            </Typography>
          </Box>
        )}
      </DialogContent>
    </DependableDialog>
  )
}
