import * as React from 'react'
import { Box, Button, IconButton, TextField, Typography } from '@mui/material'
import KeyboardArrowLeftRoundedIcon from '@mui/icons-material/KeyboardArrowLeftRounded'
import KeyboardArrowRightRoundedIcon from '@mui/icons-material/KeyboardArrowRightRounded'
import FitScreenRoundedIcon from '@mui/icons-material/FitScreenRounded'
import ZoomInRoundedIcon from '@mui/icons-material/ZoomInRounded'
import ZoomOutRoundedIcon from '@mui/icons-material/ZoomOutRounded'
import RestartAltRoundedIcon from '@mui/icons-material/RestartAltRounded'
import type { PdfReaderLayout } from './pdfReaderLayout'
import { softButtonSx } from '../pluginUiStyles'

export function PdfReaderToolbar({
  pageCount,
  scale,
  targetPage,
  layout,
  spreadStartPage,
  onTargetPageChange,
  onJumpToTargetPage,
  onLayoutChange,
  onPreviousSpread,
  onNextSpread,
  onResetSpreadView,
  onZoomOut,
  onResetZoom,
  onZoomIn,
}: {
  pageCount: number
  scale: number
  targetPage: string
  layout: PdfReaderLayout
  spreadStartPage: number
  onTargetPageChange: (value: string) => void
  onJumpToTargetPage: (event: React.FormEvent<HTMLFormElement>) => void
  onLayoutChange: (layout: PdfReaderLayout) => void
  onPreviousSpread: () => void
  onNextSpread: () => void
  onResetSpreadView: () => void
  onZoomOut: () => void
  onResetZoom: () => void
  onZoomIn: () => void
}) {
  const spreadEndPage = Math.min(spreadStartPage + 1, pageCount)

  return (
    <Box
      aria-label="PDF 阅读控制"
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 0.75,
        flexWrap: 'wrap',
        minWidth: 0,
      }}
    >
      <Typography sx={{ fontSize: 12, fontWeight: 800, color: 'rgba(0,0,0,.62)', whiteSpace: 'nowrap' }}>
        {layout === 'spread' ? `${spreadStartPage}-${spreadEndPage}` : `${pageCount} 页`} · {Math.round(scale * 100)}%
      </Typography>
      <Button size="small" variant="text" onClick={() => onLayoutChange(layout === 'spread' ? 'scroll' : 'spread')} sx={{ ...softButtonSx, minWidth: 72, height: 28, px: 1, fontSize: 12 }}>
        {layout === 'spread' ? '连续滚动' : '双页翻页'}
      </Button>
      {layout === 'spread' ? (
        <>
          <IconButton size="small" aria-label="上一组 PDF 双页" onClick={onPreviousSpread} disabled={spreadStartPage <= 1} sx={{ color: 'rgba(0,0,0,.62)', bgcolor: 'rgba(0,0,0,.045)', '&:hover': { bgcolor: 'rgba(0,0,0,.08)', color: '#111' } }}>
            <KeyboardArrowLeftRoundedIcon fontSize="small" />
          </IconButton>
          <IconButton size="small" aria-label="下一组 PDF 双页" onClick={onNextSpread} disabled={spreadEndPage >= pageCount} sx={{ color: 'rgba(0,0,0,.62)', bgcolor: 'rgba(0,0,0,.045)', '&:hover': { bgcolor: 'rgba(0,0,0,.08)', color: '#111' } }}>
            <KeyboardArrowRightRoundedIcon fontSize="small" />
          </IconButton>
          <IconButton size="small" aria-label="重置 PDF 双页视角" onClick={onResetSpreadView} sx={{ color: 'rgba(0,0,0,.62)', bgcolor: 'rgba(0,0,0,.045)', '&:hover': { bgcolor: 'rgba(0,0,0,.08)', color: '#111' } }}>
            <FitScreenRoundedIcon fontSize="small" />
          </IconButton>
        </>
      ) : null}
      <Box
        component="form"
        onSubmit={onJumpToTargetPage}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          minWidth: 0,
          px: 0.65,
          py: 0.35,
          borderRadius: 999,
          bgcolor: 'rgba(0,0,0,.045)',
        }}
      >
        <TextField
          value={targetPage}
          onChange={event => onTargetPageChange(event.target.value)}
          type="number"
          size="small"
          aria-label="跳转到 PDF 页码"
          inputProps={{ min: 1, max: pageCount, step: 1 }}
          sx={{
            width: 68,
            '& .MuiInputBase-root': { height: 28, fontSize: 12, fontWeight: 800, bgcolor: 'rgba(255,255,255,.72)' },
            '& .MuiOutlinedInput-notchedOutline': { borderColor: 'transparent' },
            '& .Mui-focused': { bgcolor: 'rgba(255,255,255,.95)', boxShadow: '0 10px 24px rgba(0,0,0,.08)' },
            '& input': { textAlign: 'center', px: 1 },
          }}
        />
        <Typography sx={{ fontSize: 12, color: 'rgba(0,0,0,.48)', whiteSpace: 'nowrap' }}>/ {pageCount}</Typography>
        <Button type="submit" size="small" variant="text" sx={{ ...softButtonSx, minWidth: 48, height: 28, px: 1, fontSize: 12 }}>
          跳转
        </Button>
      </Box>
      <IconButton size="small" aria-label="缩小 PDF" onClick={onZoomOut} sx={{ color: 'rgba(0,0,0,.62)', bgcolor: 'rgba(0,0,0,.045)', '&:hover': { bgcolor: 'rgba(0,0,0,.08)', color: '#111' } }}>
        <ZoomOutRoundedIcon fontSize="small" />
      </IconButton>
      <IconButton size="small" aria-label="重置 PDF 缩放" onClick={onResetZoom} sx={{ color: 'rgba(0,0,0,.62)', bgcolor: 'rgba(0,0,0,.045)', '&:hover': { bgcolor: 'rgba(0,0,0,.08)', color: '#111' } }}>
        <RestartAltRoundedIcon fontSize="small" />
      </IconButton>
      <IconButton size="small" aria-label="放大 PDF" onClick={onZoomIn} sx={{ color: 'rgba(0,0,0,.62)', bgcolor: 'rgba(0,0,0,.045)', '&:hover': { bgcolor: 'rgba(0,0,0,.08)', color: '#111' } }}>
        <ZoomInRoundedIcon fontSize="small" />
      </IconButton>
    </Box>
  )
}
