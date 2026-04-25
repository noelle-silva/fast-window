import * as React from 'react'
import { Box, Typography } from '@mui/material'
import FolderRoundedIcon from '@mui/icons-material/FolderRounded'

type Props = {
  folderId: string
  title: string
  refCount: number
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
  const { folderId, title, refCount, onClick } = props
  const tint = folderTint(folderId)

  return (
    <Box
      onClick={() => onClick(folderId)}
      role="button"
      tabIndex={0}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick(folderId)
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
            bgcolor: tint.bg,
            color: tint.fg,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <FolderRoundedIcon fontSize="small" />
        </Box>

        <Box sx={{ minWidth: 0, flex: 1 }}>
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
            {title || '未命名文件夹'}
          </Typography>
          <Typography sx={{ fontSize: 12, lineHeight: 1.6, color: 'rgba(0,0,0,.45)' }}>
            {refCount} 条
          </Typography>
        </Box>
      </Box>
    </Box>
  )
}

