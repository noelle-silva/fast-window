import * as React from 'react'
import { Box, Typography } from '@mui/material'
import FolderRoundedIcon from '@mui/icons-material/FolderRounded'
import { CardFrame } from './CardFrame'
import { formatCountLabel } from './cardMeta'

type Props = {
  folderId: string
  title: string
  description?: string
  refCount: number
  disabled?: boolean
  compact?: boolean
  onClick: (folderId: string) => void
}

function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return h
}

function folderTint(folderId: string): { bg: string; fg: string } {
  const palette = [
    { bg: 'rgba(25,118,210,.12)', fg: '#1565c0' },
    { bg: 'rgba(46,125,50,.12)', fg: '#2e7d32' },
    { bg: 'rgba(123,31,162,.12)', fg: '#7b1fa2' },
    { bg: 'rgba(239,108,0,.12)', fg: '#ef6c00' },
    { bg: 'rgba(0,131,143,.12)', fg: '#00838f' },
    { bg: 'rgba(109,76,65,.12)', fg: '#6d4c41' },
  ]
  const idx = Math.abs(hashString(String(folderId || ''))) % palette.length
  return palette[idx] || palette[0]
}

export function FolderCard(props: Props): React.ReactNode {
  const { folderId, title, description, refCount, disabled, compact = false, onClick } = props
  const tint = folderTint(folderId)
  const desc = String(description || '').trim()

  return (
    <CardFrame
      accent={tint.fg}
      accentSoft={tint.bg}
      icon={<FolderRoundedIcon fontSize="small" />}
      title={title || '未命名收藏夹'}
      subtitle={desc || '收藏夹说明'}
      meta="收藏夹"
      onClick={disabled ? undefined : () => onClick(folderId)}
    >
      {compact ? null : (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
          <Box sx={{ px: 1, py: 0.55, borderRadius: 2.5, bgcolor: `${tint.bg}` }}>
            <Typography sx={{ fontSize: 12, lineHeight: 1.2, fontWeight: 700, color: tint.fg }}>{formatCountLabel(refCount, '项目')}</Typography>
          </Box>
        </Box>
      )}
    </CardFrame>
  )
}
