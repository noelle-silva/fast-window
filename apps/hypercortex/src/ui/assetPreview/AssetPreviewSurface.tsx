import * as React from 'react'
import { Box, Typography } from '@mui/material'
import type { AssetEntry } from '../../assetTypes'
import { bindMediaPlaybackReporter } from '../../mediaPlayback'
import { enhanceVideoElement } from '../../videoPlayer'
import type { PreviewController } from '../preview/usePreviewController'
import { getAssetPreviewDescriptor } from './registry'
import { WordAssetReader } from './WordAssetReader'
import { PdfAssetReader } from './PdfAssetReader'
import { ImageAssetReader } from './ImageAssetReader'

function VideoAssetReader({ blobUrl, title, onPlayingChange }: { blobUrl: string; title: string; onPlayingChange?: (playing: boolean) => void }) {
  const videoRef = React.useRef<HTMLVideoElement | null>(null)
  const onPlayingChangeRef = React.useRef<typeof onPlayingChange>(onPlayingChange)

  React.useEffect(() => {
    onPlayingChangeRef.current = onPlayingChange
  }, [onPlayingChange])

  React.useEffect(() => {
    const video = videoRef.current
    if (!video || !blobUrl) return
    const cleanupPlayer = enhanceVideoElement(video)
    const cleanupReporter = bindMediaPlaybackReporter(video, playing => onPlayingChangeRef.current?.(playing))
    return () => {
      cleanupReporter()
      cleanupPlayer()
    }
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
  previewController,
  onPlayingChange,
}: {
  asset: AssetEntry
  blobUrl: string
  title: string
  previewController: PreviewController
  onPlayingChange?: (playing: boolean) => void
}) {
  const descriptor = getAssetPreviewDescriptor(asset)

  if (descriptor.kind === 'image') return <ImageAssetReader blobUrl={blobUrl} title={title} previewController={previewController} />
  if (descriptor.kind === 'video') return <VideoAssetReader blobUrl={blobUrl} title={title} onPlayingChange={onPlayingChange} />
  if (descriptor.kind === 'pdf') return <PdfAssetReader asset={asset} blobUrl={blobUrl} title={title} />
  if (descriptor.kind === 'word') return <WordAssetReader asset={asset} blobUrl={blobUrl} title={title} />

  if (descriptor.Reader) {
    const Reader = descriptor.Reader
    return <Reader asset={asset} blobUrl={blobUrl} title={title} />
  }

  return <Typography sx={{ fontSize: 13, color: 'rgba(0,0,0,.55)' }}>暂不支持预览该类型附件。</Typography>
}
