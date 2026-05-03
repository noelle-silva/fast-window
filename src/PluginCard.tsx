import { Box, Avatar, Typography } from '@mui/material'
import type { Plugin, PluginBrowseLayout } from './constants'
import { isDataImageUrl } from './utils'

export interface PluginCardProps {
  plugin: Plugin
  layout: PluginBrowseLayout
  selected: boolean
  dragging: boolean
  dragOverId: string | null
  dragOverAfter: boolean
  reorderMode: boolean
  onPointerDown?: (e: React.PointerEvent) => void
  onPointerMove?: (e: React.PointerEvent) => void
  onPointerUp?: () => void
  onPointerCancel?: () => void
}

const gridCardSx = {
  borderRadius: 2,
  alignItems: 'stretch',
  flexDirection: 'column',
  gap: 1,
  py: 1.25,
  px: 1.25,
  border: 'none',
  '&.Mui-selected': { bgcolor: 'transparent' },
  '&.Mui-selected:hover': { bgcolor: 'action.hover' },
} as const

const iconCardSx = {
  borderRadius: 2,
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  py: 1.25,
  px: 1,
  gap: 0.75,
  '&.Mui-selected': { bgcolor: 'transparent' },
  '&.Mui-selected:hover': { bgcolor: 'action.hover' },
} as const

const listCardSx = {
  py: 1,
  px: 1.25,
  '&.Mui-selected': { bgcolor: 'transparent' },
  '&.Mui-selected:hover': { bgcolor: 'action.hover' },
} as const

export function PluginCardContent(props: { plugin: Plugin; layout: PluginBrowseLayout }) {
  const { plugin, layout } = props
  const isRegisteredAppRunning = plugin.appStatus?.type === 'registered-app' && plugin.appStatus.running
  const avatarWithStatus = (
    avatar: React.ReactNode,
    size: number,
  ) => (
    <Box sx={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      {avatar}
      {isRegisteredAppRunning ? (
        <Box
          title="运行中"
          aria-label="运行中"
          sx={theme => ({
            position: 'absolute',
            right: -1,
            top: -1,
            width: 12,
            height: 12,
            borderRadius: '999px',
            bgcolor: theme.palette.success.main,
            boxShadow: `0 0 0 2px ${theme.palette.background.paper}`,
          })}
        />
      ) : null}
    </Box>
  )

  if (layout === 'icon') {
    return (
      <>
        {avatarWithStatus(
          <Avatar
            src={isDataImageUrl(plugin.icon) ? plugin.icon : undefined}
            imgProps={{ alt: plugin.name }}
            sx={{
              width: 56,
              height: 56,
              fontSize: 26,
              bgcolor: 'action.hover',
              color: 'text.primary',
            }}
          >
            {isDataImageUrl(plugin.icon) ? null : plugin.icon}
          </Avatar>,
          56,
        )}
        <Typography
          variant="caption"
          sx={{
            fontWeight: 700,
            lineHeight: 1.2,
            textAlign: 'center',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
          }}
        >
          {plugin.name}
        </Typography>
      </>
    )
  }

  if (layout === 'grid') {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        {avatarWithStatus(
          <Avatar
            variant="rounded"
            src={isDataImageUrl(plugin.icon) ? plugin.icon : undefined}
            imgProps={{ alt: plugin.name }}
            sx={theme => ({
              width: 36,
              height: 36,
              fontSize: 18,
              bgcolor: theme.palette.action.hover,
              color: theme.palette.text.primary,
            })}
          >
            {isDataImageUrl(plugin.icon) ? null : plugin.icon}
          </Avatar>,
          36,
        )}
        <Box sx={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
          <Typography
            variant="body2"
            sx={{ fontWeight: 700, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis' }}
            noWrap
          >
            {plugin.name}
          </Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}
            noWrap
          >
            {plugin.description}
          </Typography>
        </Box>
      </Box>
    )
  }

  // list
  return (
    <>
      <Box component="span" sx={{ minWidth: 44, display: 'inline-flex', flexShrink: 0 }}>
        {avatarWithStatus(
          <Avatar
            variant="rounded"
            src={isDataImageUrl(plugin.icon) ? plugin.icon : undefined}
            imgProps={{ alt: plugin.name }}
            sx={theme => ({
              width: 32,
              height: 32,
              fontSize: 18,
              bgcolor: theme.palette.action.hover,
              color: theme.palette.text.primary,
            })}
          >
            {isDataImageUrl(plugin.icon) ? null : plugin.icon}
          </Avatar>,
          32,
        )}
      </Box>
      <Box component="span" sx={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column' }}>
        <Typography variant="body1" fontWeight={600} noWrap>
          {plugin.name}
        </Typography>
        <Typography variant="body2" color="text.secondary" noWrap>
          {plugin.description}
        </Typography>
      </Box>
    </>
  )
}

export function getCardDragStyles(draggingId: string | null, dragOverId: string | null, dragOverAfter: boolean, reorderMode: boolean, pluginId: string) {
  return {
    cursor: reorderMode ? (draggingId ? 'grabbing' : 'grab') : undefined,
    opacity: draggingId === pluginId ? 0.6 : 1,
    userSelect: reorderMode ? ('none' as const) : undefined,
    touchAction: reorderMode ? ('none' as const) : undefined,
    boxShadow:
      dragOverId === pluginId
        ? ((theme: any) =>
            dragOverAfter
              ? `inset 0 -2px 0 ${theme.palette.primary.main}`
              : `inset 0 2px 0 ${theme.palette.primary.main}`)
        : undefined,
  }
}

export function getCardSx(layout: PluginBrowseLayout) {
  if (layout === 'grid') return gridCardSx
  if (layout === 'icon') return iconCardSx
  return listCardSx
}
