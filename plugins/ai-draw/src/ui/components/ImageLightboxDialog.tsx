import * as React from 'react'
import { Box, Dialog, IconButton, Typography } from '@mui/material'
import NavigateBeforeRoundedIcon from '@mui/icons-material/NavigateBeforeRounded'
import NavigateNextRoundedIcon from '@mui/icons-material/NavigateNextRounded'

export type ImageLightboxDialogProps = {
  open: boolean
  src: string
  loading?: boolean
  error?: string
  index: number
  count: number
  canPrev: boolean
  canNext: boolean
  onPrev: () => void
  onNext: () => void
  onClose: () => void
}

export function ImageLightboxDialog(props: ImageLightboxDialogProps) {
  const {
    open,
    src,
    loading = false,
    error = '',
    index,
    count,
    canPrev,
    canNext,
    onPrev,
    onNext,
    onClose,
  } = props

  const label = count > 0 ? `${Math.max(0, index) + 1}/${count}` : ''

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={false}
      PaperProps={{
        sx: {
          bgcolor: 'transparent',
          boxShadow: 'none',
          overflow: 'visible',
        },
      }}
    >
      <Box
        onClick={onClose}
        sx={{
          position: 'relative',
          width: 'min(92vw, 1180px)',
          height: 'min(86vh, calc(100vh - 24px))',
          bgcolor: 'rgba(16,16,16,0.96)',
          borderRadius: 3,
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <IconButton
          size="small"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onPrev()
          }}
          disabled={!canPrev}
          aria-label="上一张"
          sx={{
            position: 'absolute',
            left: 10,
            top: '50%',
            transform: 'translateY(-50%)',
            bgcolor: 'rgba(255,255,255,0.16)',
            color: 'rgba(255,255,255,0.88)',
            '&:hover': { bgcolor: 'rgba(255,255,255,0.24)' },
          }}
        >
          <NavigateBeforeRoundedIcon fontSize="small" />
        </IconButton>

        <IconButton
          size="small"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onNext()
          }}
          disabled={!canNext}
          aria-label="下一张"
          sx={{
            position: 'absolute',
            right: 10,
            top: '50%',
            transform: 'translateY(-50%)',
            bgcolor: 'rgba(255,255,255,0.16)',
            color: 'rgba(255,255,255,0.88)',
            '&:hover': { bgcolor: 'rgba(255,255,255,0.24)' },
          }}
        >
          <NavigateNextRoundedIcon fontSize="small" />
        </IconButton>

        {label ? (
          <Typography
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
            sx={{
              position: 'absolute',
              left: '50%',
              bottom: 10,
              transform: 'translateX(-50%)',
              fontSize: 12,
              color: 'rgba(255,255,255,0.68)',
              userSelect: 'none',
              px: 1,
              py: 0.25,
              borderRadius: 99,
              bgcolor: 'rgba(255,255,255,0.10)',
              border: '1px solid rgba(255,255,255,0.10)',
            }}
          >
            {label}
          </Typography>
        ) : null}

        {src ? (
          <Box
            component="img"
            src={src}
            alt="图片预览"
            decoding="async"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
            sx={{
              display: 'block',
              maxWidth: '100%',
              maxHeight: '100%',
              objectFit: 'contain',
            }}
          />
        ) : error ? (
          <Typography
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
            sx={{ fontSize: 13, color: 'rgba(255,120,120,0.92)' }}
          >
            {error || '加载失败'}
          </Typography>
        ) : loading ? (
          <Typography
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
            sx={{ fontSize: 13, color: 'rgba(255,255,255,0.72)' }}
          >
            加载中…
          </Typography>
        ) : (
          <Typography
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
            sx={{ fontSize: 13, color: 'rgba(255,255,255,0.72)' }}
          >
            暂无图片
          </Typography>
        )}
      </Box>
    </Dialog>
  )
}
