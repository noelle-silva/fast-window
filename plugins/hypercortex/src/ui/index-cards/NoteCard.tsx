import * as React from 'react'
import { Box, Typography } from '@mui/material'
import DescriptionRoundedIcon from '@mui/icons-material/DescriptionRounded'
import type { NoteMeta } from '../../core'
import { CardFrame } from './CardFrame'
import { formatTimeAgo } from './cardMeta'

type Props = {
  note: NoteMeta
  disabled?: boolean
  compact?: boolean
  onClick: (note: NoteMeta) => void
}

export function NoteCard(props: Props): React.ReactNode {
  const { note, disabled, compact = false, onClick } = props
  const subtitle = note.dir ? `目录：${note.dir}` : '没有目录信息'

  return (
    <CardFrame
      accent="#7c3aed"
      accentSoft="rgba(124,58,237,.12)"
      icon={<DescriptionRoundedIcon fontSize="small" />}
      title={note.title || '未命名笔记'}
      subtitle={subtitle}
      meta="笔记"
      onClick={disabled ? undefined : () => onClick(note)}
    >
      {compact ? null : (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
          <Box sx={{ px: 1, py: 0.55, borderRadius: 2.5, bgcolor: 'rgba(124,58,237,.08)' }}>
            <Typography sx={{ fontSize: 12, lineHeight: 1.2, fontWeight: 700, color: '#6d28d9' }}>{formatTimeAgo(note.updatedAtMs)}</Typography>
          </Box>
        </Box>
      )}
    </CardFrame>
  )
}
