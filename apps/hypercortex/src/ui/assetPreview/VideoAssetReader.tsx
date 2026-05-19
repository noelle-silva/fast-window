import * as React from 'react'
import { Box } from '@mui/material'
import { bindMediaPlaybackReporter } from '../../mediaPlayback'
import { enhanceVideoElement } from '../../videoPlayer'
import type { AssetPreviewContext } from './registry'

export function VideoAssetReader({ blobUrl, title, onPlayingChange }: AssetPreviewContext) {
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
