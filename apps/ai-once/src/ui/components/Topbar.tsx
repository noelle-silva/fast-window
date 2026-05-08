import * as React from 'react'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import FolderRoundedIcon from '@mui/icons-material/FolderRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined'
import SmartToyRoundedIcon from '@mui/icons-material/SmartToyRounded'
import StorageRoundedIcon from '@mui/icons-material/StorageRounded'
import WorkspacesRoundedIcon from '@mui/icons-material/WorkspacesRounded'
import { Box, Button, Chip, IconButton, Tooltip, Typography } from '@mui/material'
import { OldPluginIcon } from '../../components/Icon'
import { isInteractiveTarget } from '../../shared/aiOnceDomain'
import type { AiOnceController } from '../hooks/useAiOnceController'
import { StandaloneWindowControls } from './StandaloneWindowControls'
import { StatusBadge } from './StatusBadge'

type TopbarProps = {
  controller: AiOnceController
}

export function Topbar(props: TopbarProps) {
  const { controller } = props
  const { state } = controller

  const run = React.useCallback((fn: () => Promise<void> | void) => {
    Promise.resolve(fn()).catch(error => controller.setError(String((error as { message?: string })?.message || error || '操作失败')))
  }, [controller])

  const handlePointerDown = React.useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || isInteractiveTarget(event.target)) return
    run(controller.windowActions.startDragging)
  }, [controller.windowActions.startDragging, run])

  return (
    <Box
      data-area="topbar"
      onPointerDown={handlePointerDown}
      sx={{
        minHeight: 48,
        bgcolor: 'background.paper',
        display: 'grid',
        gridTemplateColumns: { xs: '1fr auto', lg: 'minmax(240px, 1fr) auto minmax(260px, 1fr)' },
        alignItems: 'center',
        gap: 1,
        px: 1.25,
        py: { xs: 0.75, lg: 0 },
        boxShadow: '0 10px 24px rgba(15, 23, 42, 0.06)',
        flexShrink: 0,
        userSelect: 'none',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
        <Box aria-hidden="true" sx={{ width: 32, height: 32, flex: '0 0 auto', display: 'inline-flex' }}>
          <OldPluginIcon />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 900, lineHeight: 1.1 }}>AI Once</Typography>
          <Typography variant="caption" color="text.secondary" title={controller.providerLine} sx={{ display: { xs: 'none', sm: 'block' }, maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {controller.providerLine}
          </Typography>
        </Box>
      </Box>

      <Box data-window-drag-ignore="true" sx={{ display: 'flex', alignItems: 'center', justifyContent: { xs: 'flex-end', lg: 'center' }, gap: 0.75, flexWrap: 'wrap' }}>
        <Tooltip title="空间列表">
          <span>
            <IconButton aria-label="空间列表" onClick={() => controller.setView('spaces')} sx={viewButtonSx(state.view === 'spaces')} disabled={!controller.state.data}>
              <FolderRoundedIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="工作台">
          <span>
            <IconButton aria-label="工作台" onClick={() => controller.setView('workbench')} sx={viewButtonSx(state.view === 'workbench')} disabled={!controller.state.data}>
              <SmartToyRoundedIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Button startIcon={<WorkspacesRoundedIcon fontSize="small" />} onClick={() => controller.setView('spaces')} disabled={!controller.state.data} sx={{ display: { xs: 'none', sm: 'inline-flex' } }}>
          空间
        </Button>
        <Button startIcon={<SmartToyRoundedIcon fontSize="small" />} onClick={() => controller.setView('workbench')} disabled={!controller.state.data} sx={{ display: { xs: 'none', sm: 'inline-flex' } }}>
          工作台
        </Button>
      </Box>

      <Box data-window-drag-ignore="true" sx={{ gridColumn: { xs: '1 / -1', lg: 'auto' }, display: 'flex', alignItems: 'center', justifyContent: { xs: 'space-between', lg: 'flex-end' }, gap: 0.75, minWidth: 0, flexWrap: 'wrap' }}>
        <StatusBadge phase={state.phase} />
        <Chip size="small" label={state.launchInfo.standalone ? 'standalone' : `FW ${state.launchInfo.mode}`} sx={{ display: { xs: 'none', md: 'inline-flex' } }} />
        <Tooltip title="返回空间列表">
          <span>
            <IconButton aria-label="返回空间列表" onClick={() => controller.setView('spaces')} disabled={!controller.state.data}>
              <ArrowBackRoundedIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="选择数据目录">
          <span>
            <IconButton aria-label="选择数据目录" onClick={() => run(controller.pickDataDir)} disabled={state.busy}>
              <StorageRoundedIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="重启后台并重连">
          <span>
            <IconButton aria-label="重启后台并重连" onClick={() => run(() => controller.connect({ restartBackend: true }))} disabled={state.busy}>
              <RefreshRoundedIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="设置">
          <span>
            <IconButton aria-label="设置" onClick={controller.openSettings} disabled={!controller.state.data}>
              <SettingsOutlinedIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        {state.launchInfo.standalone ? <StandaloneWindowControls actions={controller.windowActions} /> : null}
      </Box>
    </Box>
  )
}

function viewButtonSx(active: boolean) {
  return {
    bgcolor: active ? 'primary.main' : 'transparent',
    color: active ? 'primary.contrastText' : 'text.secondary',
    '&:hover': { bgcolor: active ? 'primary.dark' : 'action.hover' },
    '&.Mui-disabled': { bgcolor: active ? 'action.selected' : 'transparent' },
  }
}
