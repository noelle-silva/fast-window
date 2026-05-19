import * as React from 'react'
import { Box, Typography } from '@mui/material'
import FolderRoundedIcon from '@mui/icons-material/FolderRounded'
import { CardFrame } from './CardFrame'
import { formatCountLabel } from './cardMeta'
import { stableToneFromString, toneChipSx, toneFgVar } from '../uiTones'

type Props = {
  folderId: string
  title: string
  description?: string
  refCount: number
  disabled?: boolean
  compact?: boolean
  onClick: (folderId: string) => void
}

export function FolderCard(props: Props): React.ReactNode {
  const { folderId, title, description, refCount, disabled, compact = false, onClick } = props
  const tone = stableToneFromString(folderId || title || 'folder')
  const desc = String(description || '').trim()

  return (
    <CardFrame
      tone={tone}
      icon={<FolderRoundedIcon fontSize="small" />}
      title={title || '未命名收藏夹'}
      subtitle={desc || undefined}
      meta="收藏夹"
      onClick={disabled ? undefined : () => onClick(folderId)}
    >
      {compact ? null : (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
          <Box sx={{ px: 1, py: 0.55, borderRadius: 2.5, ...toneChipSx(tone) }}>
            <Typography sx={{ fontSize: 12, lineHeight: 1.2, fontWeight: 700, color: toneFgVar(tone) }}>{formatCountLabel(refCount, '项目')}</Typography>
          </Box>
        </Box>
      )}
    </CardFrame>
  )
}
