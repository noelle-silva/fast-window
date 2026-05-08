import * as React from 'react'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined'
import { Box, Button, Chip, IconButton, Tooltip } from '@mui/material'
import { isInteractiveTarget } from '../../shared/aiOnceDomain'
import type { AiOnceController } from '../hooks/useAiOnceController'
import { StandaloneWindowControls } from './StandaloneWindowControls'

type TopbarProps = {
  controller: AiOnceController
}

type TopbarActionProps = {
  label: string
  icon: React.ElementType
  onClick: () => void
  disabled?: boolean
}

export function Topbar(props: TopbarProps) {
  const { controller } = props
  const { state } = controller
  const hasData = !!state.data

  const run = React.useCallback((fn: () => Promise<void> | void) => {
    Promise.resolve(fn()).catch(error => controller.setError(String((error as { message?: string })?.message || error || '操作失败')))
  }, [controller])

  const returnToSpaces = React.useCallback(() => {
    controller.setView('spaces')
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
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 1,
        px: 1.25,
        py: { xs: 0.75, lg: 0 },
        boxShadow: '0 10px 24px rgba(15, 23, 42, 0.06)',
        flexShrink: 0,
        userSelect: 'none',
      }}
    >
      <Box data-window-drag-ignore="true" sx={{ display: 'flex', alignItems: 'center', minWidth: 40 }}>
        {state.view === 'workbench' ? (
          <Tooltip title="返回空间列表">
            <span>
              <IconButton aria-label="返回空间列表" onClick={returnToSpaces} disabled={!hasData}>
                <ArrowBackRoundedIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        ) : null}
      </Box>

      <Box data-window-drag-ignore="true" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0.75, minWidth: 0, flexWrap: 'wrap' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
          <TopbarAction label="新建空间" icon={AddRoundedIcon} onClick={controller.openCreateSpaceDialog} disabled={!hasData || state.busy} />
          <TopbarAction label="供应商设置" icon={SettingsOutlinedIcon} onClick={controller.openSettings} disabled={!hasData} />
          <TopbarAction label="应用设置" icon={SettingsOutlinedIcon} onClick={() => controller.setDialog('app-settings')} />
        </Box>
        <Chip size="small" label={state.launchInfo.standalone ? 'standalone' : `FW ${state.launchInfo.mode}`} sx={{ display: { xs: 'none', md: 'inline-flex' } }} />
        {state.launchInfo.standalone ? <StandaloneWindowControls actions={controller.windowActions} /> : null}
      </Box>
    </Box>
  )
}

function TopbarAction(props: TopbarActionProps) {
  const { label, icon: Icon, onClick, disabled } = props

  return (
    <>
      <Tooltip title={label}>
        <span>
          <IconButton aria-label={label} onClick={onClick} disabled={disabled} size="small" sx={{ display: { xs: 'inline-flex', sm: 'none' } }}>
            <Icon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title={label}>
        <span>
          <Button startIcon={<Icon fontSize="small" />} onClick={onClick} disabled={disabled} size="small" sx={{ display: { xs: 'none', sm: 'inline-flex' } }}>
            {label}
          </Button>
        </span>
      </Tooltip>
    </>
  )
}
