import * as React from 'react'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import { Box, Button, IconButton, Stack, Typography } from '@mui/material'
import { DESKTOP_GRID_ICON_TITLE_SHADOW } from '../visual/iconTokens'

type Props = {
  children: React.ReactNode
  editLabel?: string
  empty?: React.ReactNode
  onClose(): void
  onEdit?(): void
  open: boolean
  title: string
}

export function ContainerOverlay(props: Props): React.ReactNode {
  const { onClose, open } = props

  React.useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, open])

  if (!open) return null

  return (
    <Box
      role="dialog"
      aria-modal="true"
      aria-labelledby="desktop-grid-container-overlay-title"
      onClick={props.onClose}
      sx={{
        position: 'fixed',
        inset: 0,
        zIndex: theme => theme.zIndex.modal,
        display: 'grid',
        gridTemplateRows: 'auto minmax(0, 1fr)',
        px: { xs: 1.5, sm: 4, lg: 7 },
        pt: { xs: 4.5, sm: 5.5 },
        pb: { xs: 2.5, sm: 5 },
        background: 'rgba(2, 6, 23, 0.56)',
        backdropFilter: 'blur(10px) saturate(0.82)',
        WebkitBackdropFilter: 'blur(10px) saturate(0.82)',
      }}
    >
      <Stack direction="row" alignItems="center" justifyContent="center" sx={{ position: 'relative', minHeight: 64 }}>
        <Typography
          id="desktop-grid-container-overlay-title"
          variant="h1"
          sx={{
            color: '#FFFFFF',
            fontSize: { xs: 28, sm: 40 },
            fontWeight: 950,
            letterSpacing: '-0.035em',
            textAlign: 'center',
            textShadow: DESKTOP_GRID_ICON_TITLE_SHADOW,
          }}
        >
          {props.title}
        </Typography>
        <Stack direction="row" spacing={1} sx={{ position: 'absolute', right: 0 }}>
          {props.onEdit ? (
            <Button
              startIcon={<EditRoundedIcon />}
              onClick={event => { event.stopPropagation(); props.onEdit?.() }}
              sx={{ color: '#FFFFFF', bgcolor: 'rgba(255,255,255,0.12)', '&:hover': { bgcolor: 'rgba(255,255,255,0.2)' } }}
            >
              {props.editLabel || 'Edit'}
            </Button>
          ) : null}
          <IconButton
            aria-label="Close container"
            onClick={event => { event.stopPropagation(); props.onClose() }}
            sx={{ color: '#FFFFFF', bgcolor: 'rgba(255,255,255,0.12)', '&:hover': { bgcolor: 'rgba(255,255,255,0.2)' } }}
          >
            <CloseRoundedIcon />
          </IconButton>
        </Stack>
      </Stack>

      <Box
        onClick={event => event.stopPropagation()}
        sx={{
          alignSelf: 'center',
          justifySelf: 'center',
          width: 'min(92vw, 1478px)',
          minHeight: { xs: 350, sm: 334 },
          maxHeight: 'calc(100vh - 170px)',
          overflow: 'auto',
          px: { xs: 2.5, sm: 7, lg: 10 },
          py: { xs: 3, sm: 6 },
          borderRadius: { xs: 8, sm: '58px' },
          background: 'rgba(246, 249, 250, 0.92)',
          border: '1px solid rgba(255, 255, 255, 0.72)',
          boxShadow: '0 42px 90px rgba(2, 6, 23, 0.34), inset 0 1px 0 rgba(255, 255, 255, 0.78)',
          backdropFilter: 'blur(28px) saturate(1.04)',
          WebkitBackdropFilter: 'blur(28px) saturate(1.04)',
        }}
      >
        {props.children || props.empty}
      </Box>
    </Box>
  )
}
