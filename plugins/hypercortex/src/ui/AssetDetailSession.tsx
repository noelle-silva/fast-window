import * as React from 'react'
import { Box, Button, CircularProgress, Typography } from '@mui/material'
import ImageRoundedIcon from '@mui/icons-material/ImageRounded'
import VideoFileRoundedIcon from '@mui/icons-material/VideoFileRounded'
import InsertDriveFileRoundedIcon from '@mui/icons-material/InsertDriveFileRounded'
import type { Api, VaultScope } from '../core'
import { pickAssetDisplayName } from '../assetDisplayName'
import type { AssetEntry } from '../assetTypes'
import { assetRefKey } from '../assetTypes'
import { getAssetBlobUrl } from '../assetBlobUrl'
import { enhanceVideoElement } from '../videoPlayer'

export function AssetDetailSession({
  api,
  scope,
  asset,
  visible,
}: {
  api: Api
  scope: VaultScope
  asset: AssetEntry
  visible: boolean
}) {
  const title = React.useMemo(() => pickAssetDisplayName({ indexName: asset.displayName, ext: asset.ext }), [asset.displayName, asset.ext])
  const refText = React.useMemo(() => assetRefKey(asset), [asset.assetId, asset.ext])

  const [blobUrl, setBlobUrl] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const videoRef = React.useRef<HTMLVideoElement | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const url = await getAssetBlobUrl(api, scope, asset.assetId, asset.ext)
      setBlobUrl(url)
    } catch (e: any) {
      setError(String(e?.message || e || '加载失败'))
    } finally {
      setLoading(false)
    }
  }, [api, asset.assetId, asset.ext, scope])

  React.useEffect(() => {
    if (!visible) return
    void load()
  }, [load, visible])

  React.useEffect(() => {
    if (asset.kind !== 'video' || !blobUrl) return
    const video = videoRef.current
    if (!video) return
    return enhanceVideoElement(video)
  }, [asset.kind, blobUrl])

  const iconEl = asset.kind === 'image' ? (
    <ImageRoundedIcon fontSize="small" />
  ) : asset.kind === 'video' ? (
    <VideoFileRoundedIcon fontSize="small" />
  ) : (
    <InsertDriveFileRoundedIcon fontSize="small" />
  )

  return (
    <Box
      sx={{
        display: visible ? 'flex' : 'none',
        flex: 1,
        minHeight: 0,
        flexDirection: 'column',
        gap: 1.25,
        p: 2,
        boxSizing: 'border-box',
        overflow: 'auto',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
          <Box sx={{ color: 'rgba(0,0,0,.55)', display: 'inline-flex', alignItems: 'center' }}>{iconEl}</Box>
          <Typography noWrap sx={{ fontSize: 18, fontWeight: 900, color: '#111', minWidth: 0 }}>
            {title}
          </Typography>
        </Box>
        <Button variant="outlined" size="small" onClick={() => void load()} disabled={loading} sx={{ borderRadius: 2, textTransform: 'none' }}>
          刷新
        </Button>
      </Box>

      <Typography sx={{ fontSize: 12, color: 'rgba(0,0,0,.42)', fontFamily: 'monospace' }}>{refText}</Typography>

      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 3,
          bgcolor: 'rgba(0,0,0,.03)',
          overflow: 'hidden',
        }}
      >
        {error ? (
          <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'center' }}>
            <Typography color="error" sx={{ fontSize: 13 }}>
              {error}
            </Typography>
            <Button variant="contained" size="small" onClick={() => void load()} sx={{ borderRadius: 2, textTransform: 'none' }}>
              重试
            </Button>
          </Box>
        ) : loading && !blobUrl ? (
          <CircularProgress size={20} />
        ) : asset.kind === 'image' && blobUrl ? (
          <Box component="img" src={blobUrl} alt={title} sx={{ width: '100%', height: '100%', objectFit: 'contain', bgcolor: '#000' }} />
        ) : asset.kind === 'video' && blobUrl ? (
          <Box className="hc-video-player" sx={{ width: '100%', maxWidth: 1100 }}>
            <video key={blobUrl} ref={videoRef} src={blobUrl} controls preload="metadata" playsInline aria-label={title} />
          </Box>
        ) : (
          <Typography sx={{ fontSize: 13, color: 'rgba(0,0,0,.55)' }}>暂不支持预览该类型附件。</Typography>
        )}
      </Box>
    </Box>
  )
}
