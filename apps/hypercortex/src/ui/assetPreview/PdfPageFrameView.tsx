import * as React from 'react'
import { Box, Typography } from '@mui/material'
import { getAssetReaderPageNumberProps } from './assetReaderViewportAnchor'
import { commitPdfRenderedPageFrame } from './pdfPageRenderBuffer'
import type { PdfRenderedPageFrame } from './pdfPageRenderCache'
import type { PdfPageSize } from './pdfReaderLayout'
import { usePageVisibility } from './usePdfPageVisibility'

export function PdfPageFrameView({
  frame,
  pageNumber,
  scale,
  scrollRootRef,
  pageSize,
  visible,
  onVisible,
  forceVisible = false,
  pagePadding = { px: 2, py: 1.5 },
}: {
  frame: PdfRenderedPageFrame | null
  pageNumber: number
  scale: number
  scrollRootRef: React.RefObject<HTMLDivElement>
  pageSize: PdfPageSize
  visible: boolean
  onVisible: () => void
  forceVisible?: boolean
  pagePadding?: { px: number; py: number }
}) {
  const [pageRef, observedVisible] = usePageVisibility(scrollRootRef, pageNumber, scale, forceVisible)
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null)
  const [displayFrame, setDisplayFrame] = React.useState<PdfRenderedPageFrame | null>(frame)

  React.useEffect(() => {
    if (!observedVisible) return
    onVisible()
  }, [observedVisible, onVisible])

  React.useEffect(() => {
    if (!frame) return
    setDisplayFrame(frame)
    const canvas = canvasRef.current
    if (canvas) commitPdfRenderedPageFrame(canvas, frame)
  }, [frame])

  const width = Math.floor(pageSize.width * scale)
  const height = Math.floor(pageSize.height * scale)
  const shouldShowPlaceholder = !displayFrame && visible

  return (
    <Box ref={pageRef} sx={{ display: 'flex', justifyContent: 'center', px: pagePadding.px, py: pagePadding.py }}>
      <Box {...getAssetReaderPageNumberProps(pageNumber)} sx={{ position: 'relative', width, height, flex: '0 0 auto', bgcolor: '#fff', borderRadius: 1, boxShadow: '0 10px 34px rgba(0,0,0,.18)', overflow: 'hidden' }}>
        <canvas ref={canvasRef} aria-label={`PDF 第 ${pageNumber} 页`} style={{ display: displayFrame ? 'block' : 'none' }} />
        {shouldShowPlaceholder ? (
          <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(0,0,0,.42)', bgcolor: '#fffdf8' }}>
            <Typography sx={{ fontSize: 12 }}>第 {pageNumber} 页</Typography>
          </Box>
        ) : null}
      </Box>
    </Box>
  )
}
