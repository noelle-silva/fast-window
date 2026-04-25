import * as React from 'react'
import { Box, Typography } from '@mui/material'
import DescriptionRoundedIcon from '@mui/icons-material/DescriptionRounded'
import type { FavoriteItemRef } from '../../favorites'
import type { NoteMeta } from '../../core'

type Props = {
  ref: FavoriteItemRef
  note: NoteMeta
  onClick: (note: NoteMeta) => void
}

export function NoteCard(props: Props): React.ReactNode {
  const { note, onClick } = props

  return (
    <Box
      onClick={() => onClick(note)}
      role="button"
      tabIndex={0}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick(note)
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
            bgcolor: 'rgba(0,0,0,.05)',
            color: 'rgba(0,0,0,.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <DescriptionRoundedIcon fontSize="small" />
        </Box>

        <Typography
          sx={{
            fontSize: 14,
            lineHeight: 1.5,
            fontWeight: 700,
            color: '#111',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {note.title || '未命名'}
        </Typography>
      </Box>
    </Box>
  )
}

