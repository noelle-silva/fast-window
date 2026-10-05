import * as React from 'react'
import { Box } from '@mui/material'
import { PdfPageFrameView } from './PdfPageFrameView'
import type { PdfRenderedPageFrame } from './pdfPageRenderCache'
import type { PdfPageSize } from './pdfReaderLayout'

export function PdfSpreadReader({
  scale,
  spreadStartPage,
  pageCount,
  scrollRootRef,
  pageSize,
  getFrame,
  onPageVisible,
}: {
  scale: number
  spreadStartPage: number
  pageCount: number
  scrollRootRef: React.RefObject<HTMLDivElement>
  pageSize: PdfPageSize
  getFrame: (pageNumber: number) => PdfRenderedPageFrame | null
  onPageVisible: (pageNumber: number) => void
}) {
  const pageNumbers = [spreadStartPage, spreadStartPage + 1].filter(pageNumber => pageNumber <= pageCount)

  return (
    <Box sx={{ minWidth: 'max-content', height: '100%', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', gap: 0, px: 0, py: 0 }}>
      {pageNumbers.map(pageNumber => (
        <PdfPageFrameView key={pageNumber} frame={getFrame(pageNumber)} pageNumber={pageNumber} scale={scale} scrollRootRef={scrollRootRef} pageSize={pageSize} visible onVisible={() => onPageVisible(pageNumber)} forceVisible pagePadding={{ px: 0, py: 0 }} />
      ))}
    </Box>
  )
}
