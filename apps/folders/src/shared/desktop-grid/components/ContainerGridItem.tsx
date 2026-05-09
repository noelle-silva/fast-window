import * as React from 'react'
import RemoveCircleOutlineRoundedIcon from '@mui/icons-material/RemoveCircleOutlineRounded'
import { Box, ButtonBase, IconButton, Stack, Typography } from '@mui/material'

type Props = {
  detail?: string | null
  dragging?: boolean
  icon: React.ReactNode
  name: string
  onOpen(): void
  onRemove?(): void
  removeLabel?: string
  title?: string
}

export function ContainerGridItem(props: Props): React.ReactNode {
  return (
    <Box
      sx={{
        position: 'relative',
        width: 148,
        height: 164,
        display: 'grid',
        justifyItems: 'center',
        alignContent: 'start',
        pt: 0.5,
        gap: 1,
        cursor: props.dragging ? 'grabbing' : 'grab',
        userSelect: 'none',
        touchAction: 'none',
        transform: props.dragging ? 'scale(1.05)' : 'scale(1)',
        transition: props.dragging ? 'none' : 'transform .16s ease',
        '&:hover .desktop-grid-container-remove, &:focus-within .desktop-grid-container-remove': { opacity: 1, transform: 'translateY(0) scale(1)' },
      }}
    >
      <ButtonBase
        disableRipple
        onClick={props.onOpen}
        aria-label={`Open ${props.name}`}
        title={props.title || props.name}
        sx={{
          width: 132,
          display: 'grid',
          justifyItems: 'center',
          gap: 1,
          p: 0.5,
          borderRadius: 5,
          textAlign: 'center',
          '&:focus-visible': { outline: '2px solid rgba(37, 99, 235, 0.75)', outlineOffset: 4 },
        }}
      >
        {props.icon}
        <Stack spacing={0.25} sx={{ minWidth: 0, width: '100%' }}>
          <Typography noWrap fontWeight={850} title={props.name} sx={{ color: 'text.primary', fontSize: 15 }}>
            {props.name}
          </Typography>
          {props.detail ? (
            <Typography noWrap title={props.detail} variant="caption" sx={{ display: 'block', color: 'rgba(15, 23, 42, 0.45)' }}>
              {props.detail}
            </Typography>
          ) : null}
        </Stack>
      </ButtonBase>
      {props.onRemove ? (
        <IconButton
          className="desktop-grid-container-remove"
          data-desktop-grid-no-drag="1"
          aria-label={props.removeLabel || `Remove ${props.name}`}
          onClick={props.onRemove}
          size="small"
          sx={{
            position: 'absolute',
            top: -4,
            right: 18,
            opacity: { xs: 1, sm: 0 },
            transform: { xs: 'translateY(0) scale(1)', sm: 'translateY(-4px) scale(0.92)' },
            transition: 'opacity .16s ease, transform .16s ease, background-color .16s ease',
            bgcolor: 'rgba(255, 255, 255, 0.92)',
            boxShadow: '0 10px 22px rgba(15, 23, 42, 0.16)',
            '&:hover': { bgcolor: '#FFFFFF', color: 'error.main' },
          }}
        >
          <RemoveCircleOutlineRoundedIcon fontSize="small" />
        </IconButton>
      ) : null}
    </Box>
  )
}
