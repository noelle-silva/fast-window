import * as React from 'react'
import { Box } from '@mui/material'
import type { PreviewController } from '../preview/usePreviewController'
import { unstyledButtonSurfaceSx } from '../pluginUiStyles'

export function ImageAssetReader({
  blobUrl,
  title,
  previewController,
}: {
  blobUrl: string
  title: string
  previewController: PreviewController
}) {
  const rootRef = React.useRef<HTMLDivElement | null>(null)
  const imgRef = React.useRef<HTMLImageElement | null>(null)

  const openImageViewer = React.useCallback((event: React.MouseEvent) => {
    const root = rootRef.current
    const img = imgRef.current
    if (!root || !img) return
    event.preventDefault()
    previewController.actions.openImageViewer(root, img)
  }, [previewController])

  return (
    <Box
      ref={rootRef}
      sx={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: '#000',
      }}
    >
      <Box
        component="button"
        type="button"
        aria-label={`打开大图：${title}`}
        onClick={openImageViewer}
        sx={{
          ...unstyledButtonSurfaceSx,
          width: '100%',
          height: '100%',
          p: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: 'transparent',
          cursor: 'zoom-in',
        }}
      >
        <Box
          component="img"
          ref={imgRef}
          src={blobUrl}
          alt={title}
          draggable={false}
          sx={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            userSelect: 'none',
          }}
        />
      </Box>
    </Box>
  )
}
