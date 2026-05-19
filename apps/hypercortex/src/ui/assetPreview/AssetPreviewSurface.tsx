import * as React from 'react'
import { Typography } from '@mui/material'
import type { AssetEntry } from '../../assetTypes'
import type { PreviewController } from '../preview/usePreviewController'
import { getAssetPreviewDescriptor } from './registry'
import type { AssetPreviewToolbarHost } from './assetPreviewToolbar'

export function AssetPreviewSurface({
  asset,
  blobUrl,
  title,
  previewController,
  onPlayingChange,
  toolbarHost,
}: {
  asset: AssetEntry
  blobUrl: string
  title: string
  previewController: PreviewController
  onPlayingChange?: (playing: boolean) => void
  toolbarHost?: AssetPreviewToolbarHost
}) {
  const descriptor = getAssetPreviewDescriptor(asset)

  if (descriptor.Reader) {
    const Reader = descriptor.Reader
    return <Reader asset={asset} blobUrl={blobUrl} title={title} previewController={previewController} onPlayingChange={onPlayingChange} toolbarHost={toolbarHost} />
  }

  return <Typography sx={{ fontSize: 13, color: 'rgba(0,0,0,.55)' }}>暂不支持预览该类型附件。</Typography>
}
