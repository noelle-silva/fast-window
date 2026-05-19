import * as React from 'react'
import { Box, Typography } from '@mui/material'
import ImageRoundedIcon from '@mui/icons-material/ImageRounded'
import AudioFileRoundedIcon from '@mui/icons-material/AudioFileRounded'
import VideoFileRoundedIcon from '@mui/icons-material/VideoFileRounded'
import InsertDriveFileRoundedIcon from '@mui/icons-material/InsertDriveFileRounded'
import type { AssetEntry } from '../../assetTypes'
import { pickAssetDisplayName } from '../../assetDisplayName'
import { CardFrame } from './CardFrame'
import { formatFileSize, formatTimeAgo } from './cardMeta'
import { assetToneFromKind, toneChipSx, toneFgVar } from '../uiTones'

type Props = {
  asset: AssetEntry
  disabled?: boolean
  compact?: boolean
  onClick: (asset: AssetEntry) => void
}

function kindIcon(kind: string): React.ReactNode {
  if (kind === 'image') return <ImageRoundedIcon fontSize="small" />
  if (kind === 'audio') return <AudioFileRoundedIcon fontSize="small" />
  if (kind === 'video') return <VideoFileRoundedIcon fontSize="small" />
  return <InsertDriveFileRoundedIcon fontSize="small" />
}

export function AssetCard(props: Props): React.ReactNode {
  const { asset, disabled, compact = false, onClick } = props
  const name = pickAssetDisplayName({ explicitName: asset.displayName, indexName: asset.sourceName || asset.fileName, ext: asset.ext })
  const tone = assetToneFromKind(asset.kind)
  const showThumb = Boolean(asset.thumbnailUrl)
  const icon = showThumb ? (
    <Box component="img" src={asset.thumbnailUrl || ''} alt={name} sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
  ) : (
    kindIcon(asset.kind)
  )

  return (
    <CardFrame
      tone={tone}
      icon={icon}
      title={name}
      subtitle={asset.remark || asset.relPath || asset.fileName || '没有路径信息'}
      meta={asset.ext ? `.${asset.ext}` : asset.kind || '文件'}
      onClick={disabled ? undefined : () => onClick(asset)}
    >
      {compact ? null : (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
          <Box sx={{ px: 1, py: 0.55, borderRadius: 2.5, bgcolor: 'var(--hc-surface)' }}>
            <Typography sx={{ fontSize: 12, lineHeight: 1.2, fontWeight: 700, color: toneFgVar(tone) }}>{formatFileSize(asset.size)}</Typography>
          </Box>
          <Box sx={{ px: 1, py: 0.55, borderRadius: 2.5, ...toneChipSx(tone) }}>
            <Typography sx={{ fontSize: 12, lineHeight: 1.2, fontWeight: 700, color: toneFgVar(tone) }}>{formatTimeAgo(asset.modifiedMs)}</Typography>
          </Box>
        </Box>
      )}
    </CardFrame>
  )
}
