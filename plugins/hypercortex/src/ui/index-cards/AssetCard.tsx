import * as React from 'react'
import { Box, Tooltip, Typography } from '@mui/material'
import ImageRoundedIcon from '@mui/icons-material/ImageRounded'
import AudioFileRoundedIcon from '@mui/icons-material/AudioFileRounded'
import VideoFileRoundedIcon from '@mui/icons-material/VideoFileRounded'
import InsertDriveFileRoundedIcon from '@mui/icons-material/InsertDriveFileRounded'
import type { FavoriteItemRef } from '../../favorites'
import type { AssetEntry } from '../../assetTypes'
import { pickAssetDisplayName } from '../../assetDisplayName'

type Props = {
  ref: FavoriteItemRef
  asset: AssetEntry
  onClick: (asset: AssetEntry) => void
}

function kindIcon(kind: string): React.ReactNode {
  if (kind === 'image') return <ImageRoundedIcon fontSize="small" />
  if (kind === 'audio') return <AudioFileRoundedIcon fontSize="small" />
  if (kind === 'video') return <VideoFileRoundedIcon fontSize="small" />
  return <InsertDriveFileRoundedIcon fontSize="small" />
}

export function AssetCard(props: Props): React.ReactNode {
  const { asset, onClick } = props
  const name = pickAssetDisplayName({ explicitName: asset.displayName, indexName: asset.fileName, ext: asset.ext })
  const showThumb = Boolean(asset.thumbnailUrl)

  return (
    <Box
      onClick={() => onClick(asset)}
      role="button"
      tabIndex={0}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick(asset)
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
            overflow: 'hidden',
          }}
        >
          {showThumb ? (
            <Box
              component="img"
              src={asset.thumbnailUrl || ''}
              alt={name}
              sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            kindIcon(asset.kind)
          )}
        </Box>

        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Tooltip title={name}>
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
              {name}
            </Typography>
          </Tooltip>
          <Typography sx={{ fontSize: 12, lineHeight: 1.6, color: 'rgba(0,0,0,.45)' }}>
            {asset.ext ? `.${asset.ext}` : asset.kind || '文件'}
          </Typography>
        </Box>
      </Box>
    </Box>
  )
}

