import * as React from 'react'
import { Box, IconButton, Tooltip, Typography } from '@mui/material'
import LinkOffRoundedIcon from '@mui/icons-material/LinkOffRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import type { FavoriteItemRef } from '../../favorites'

type Props = {
  ref: FavoriteItemRef
  onClickRemove: (refId: string) => void
}

export function StaleRefCard(props: Props): React.ReactNode {
  const { ref, onClickRemove } = props

  return (
    <Box
      onClick={() => onClickRemove(ref.id)}
      role="button"
      tabIndex={0}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClickRemove(ref.id)
        }
      }}
      sx={{
        px: 1.5,
        py: 1.4,
        borderRadius: 3,
        bgcolor: '#fff',
        boxShadow: '0 1px 2px rgba(0,0,0,.04)',
        cursor: 'pointer',
        transition: 'background-color .16s ease, box-shadow .16s ease, transform .16s ease',
        '&:hover': {
          bgcolor: 'rgba(0,0,0,.02)',
          boxShadow: '0 6px 16px rgba(0,0,0,.08)',
          transform: 'translateY(-1px)',
        },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.1, minWidth: 0 }}>
        <Box
          sx={{
            width: 38,
            height: 38,
            borderRadius: 2.5,
            bgcolor: 'rgba(211,47,47,.10)',
            color: '#d32f2f',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <LinkOffRoundedIcon fontSize="small" />
        </Box>

        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography
            sx={{
              fontSize: 14,
              lineHeight: 1.5,
              fontWeight: 800,
              color: '#111',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            已丢失的引用
          </Typography>
          <Typography sx={{ fontSize: 12, lineHeight: 1.6, color: 'rgba(0,0,0,.45)' }}>
            点击移除这条收藏
          </Typography>
        </Box>

        <Tooltip title="移除">
          <IconButton
            size="small"
            onClick={e => {
              e.stopPropagation()
              onClickRemove(ref.id)
            }}
            sx={{ color: 'rgba(0,0,0,.55)', '&:hover': { bgcolor: 'rgba(211,47,47,.10)', color: '#d32f2f' } }}
            aria-label="移除"
          >
            <DeleteOutlineRoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
    </Box>
  )
}

