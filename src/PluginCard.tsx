import { Box, Avatar, SvgIcon, Typography } from '@mui/material'
import type { Plugin, PluginBrowseLayout } from './constants'
import { isDataImageUrl } from './utils'

const devCommandSpinKeyframes = {
  '@keyframes fastWindowDevCommandSpin': {
    '0%': { transform: 'rotate(0deg)' },
    '100%': { transform: 'rotate(360deg)' },
  },
} as const

const gridCardSx = {
  display: 'flex',
  borderRadius: 2,
  alignItems: 'stretch',
  flexDirection: 'column',
  gap: 1,
  py: 1.25,
  px: 1.25,
  border: 'none',
} as const

const iconCardSx = {
  display: 'flex',
  borderRadius: 2,
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  py: 1.25,
  px: 1,
  gap: 0.75,
} as const

const listCardSx = {
  display: 'flex',
  alignItems: 'center',
  borderRadius: 2,
  py: 1,
  px: 1.25,
} as const

const cardPointerSurfaceSx = {
  listStyle: 'none',
  cursor: 'pointer',
  userSelect: 'none',
  transition: 'background-color 120ms ease, transform 120ms ease',
  '&:hover': { bgcolor: 'action.hover' },
  '&:active': { transform: 'scale(0.995)' },
} as const

export function PluginCardContent(props: { plugin: Plugin; layout: PluginBrowseLayout }) {
  const { plugin, layout } = props
  const isRegisteredAppRunning = plugin.appStatus?.type === 'registered-app' && plugin.appStatus.running
  const isDevCommandRunning = plugin.appStatus?.type === 'registered-app' && plugin.appStatus.devCommandRunning === true
  const avatarWithBadges = (
    avatar: React.ReactNode,
    size: number,
  ) => (
    <Box sx={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      {avatar}
      {isDevCommandRunning ? (
        <Box
          title="开发命令运行中"
          aria-label="开发命令运行中"
          sx={theme => ({
            ...devCommandSpinKeyframes,
            position: 'absolute',
            inset: -4,
            borderRadius: '999px',
            border: `2px solid ${theme.palette.primary.main}`,
            borderTopColor: 'transparent',
            boxShadow: `0 0 18px ${theme.palette.primary.main}66`,
            animation: 'fastWindowDevCommandSpin 900ms linear infinite',
            pointerEvents: 'none',
          })}
        />
      ) : null}
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
      {plugin.iconBadge ? <PluginIconBadgeView badge={plugin.iconBadge} avatarSize={size} /> : null}
    </Box>
  )

  if (layout === 'icon') {
    return (
      <>
        {avatarWithBadges(
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
        {avatarWithBadges(
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
        {avatarWithBadges(
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

function PluginIconBadgeView(props: { badge: NonNullable<Plugin['iconBadge']>; avatarSize: number }) {
  const { badge, avatarSize } = props

  if (badge.kind === 'shortcut-command') {
    const badgeSize = Math.max(14, Math.round(avatarSize * 0.34))
    const iconSize = Math.max(9, Math.round(badgeSize * 0.68))

    return (
      <Box
        title={badge.label}
        aria-label={badge.label}
        role="img"
        sx={theme => ({
          position: 'absolute',
          right: -2,
          bottom: -2,
          width: badgeSize,
          height: badgeSize,
          borderRadius: '999px',
          display: 'grid',
          placeItems: 'center',
          color: theme.palette.common.white,
          bgcolor: theme.palette.primary.main,
          boxShadow: `0 0 0 2px ${theme.palette.background.paper}`,
        })}
      >
        <SvgIcon viewBox="0 0 24 24" sx={{ fontSize: iconSize }}>
          <path d="M13.2 3 5.5 13.4h5.2L9.8 21l8.7-11.4h-5.3L13.2 3Z" />
        </SvgIcon>
      </Box>
    )
  }

  const exhaustive: never = badge.kind
  return exhaustive
}

export function getCardDragSx(draggingId: string | null, dragOverId: string | null, dragOverAfter: boolean, reorderMode: boolean, pluginId: string) {
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

export function getCardPointerSurfaceSx() {
  return cardPointerSurfaceSx
}
