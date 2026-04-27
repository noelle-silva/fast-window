import * as React from 'react'
import { Box, Typography } from '@mui/material'
import type { AssetEntry } from '../../assetTypes'
import { enhanceVideoElement } from '../../videoPlayer'
import { getAssetPreviewDescriptor } from './registry'
import { WordAssetReader } from './WordAssetReader'
import { PdfAssetReader } from './PdfAssetReader'

function VideoAssetReader({ blobUrl, title }: { blobUrl: string; title: string }) {
  const videoRef = React.useRef<HTMLVideoElement | null>(null)

  React.useEffect(() => {
    const video = videoRef.current
    if (!video || !blobUrl) return
    return enhanceVideoElement(video)
  }, [blobUrl])

  return (
    <Box className="hc-video-player" sx={{ width: '100%', maxWidth: 1100 }}>
      <video key={blobUrl} ref={videoRef} src={blobUrl} controls preload="metadata" playsInline aria-label={title} />
    </Box>
  )
}

export function AssetPreviewSurface({
  asset,
  blobUrl,
  title,
}: {
  asset: AssetEntry
  blobUrl: string
  title: string
}) {
  const descriptor = getAssetPreviewDescriptor(asset)

  if (descriptor.kind === 'video') return <VideoAssetReader blobUrl={blobUrl} title={title} />
  if (descriptor.kind === 'pdf') return <PdfAssetReader asset={asset} blobUrl={blobUrl} title={title} />
  if (descriptor.kind === 'word') return <WordAssetReader asset={asset} blobUrl={blobUrl} title={title} />

  if (descriptor.Reader) {
    const Reader = descriptor.Reader
    return <Reader asset={asset} blobUrl={blobUrl} title={title} />
  }

  return <Typography sx={{ fontSize: 13, color: 'rgba(0,0,0,.55)' }}>暂不支持预览该类型附件。</Typography>
}
