import * as React from 'react'
import { Box, Button, Dialog, DialogActions, DialogContent, Stack, Typography } from '@mui/material'
import { desktopWallpaperImageStyle } from './desktopWallpaperImage'
import { DEFAULT_DESKTOP_WALLPAPER_VIEW, normalizeDesktopWallpaperView } from './desktopWallpaperPresets'
import type { DesktopWallpaperView } from './types'

type Props = {
  imageUrl: string
  initialView: DesktopWallpaperView
  open: boolean
  targetAspect: number
  onClose(): void
  onSave(view: DesktopWallpaperView): void
}

export function DesktopWallpaperViewEditorDialog(props: Props): React.ReactNode {
  const { imageUrl, initialView, open, targetAspect, onClose, onSave } = props
  const imageRef = React.useRef<HTMLImageElement | null>(null)
  const viewRef = React.useRef<DesktopWallpaperView>(normalizeDesktopWallpaperView(initialView))
  const frameSizeRef = React.useRef({ width: 1, height: 1 })
  const animationFrameRef = React.useRef<number | null>(null)
  const [, refreshViewLabel] = React.useState(0)
  const [dragging, setDragging] = React.useState(false)
  const frameRef = React.useRef<HTMLDivElement | null>(null)
  const dragRef = React.useRef<{ x: number; y: number; start: DesktopWallpaperView } | null>(null)

  const commitPreviewView = React.useCallback((nextView: DesktopWallpaperView, updateLabel = true) => {
    viewRef.current = normalizeDesktopWallpaperView(nextView)
    if (animationFrameRef.current == null) {
      animationFrameRef.current = window.requestAnimationFrame(() => {
        animationFrameRef.current = null
        Object.assign(imageRef.current?.style || {}, desktopWallpaperImageStyle(viewRef.current))
      })
    }
    if (updateLabel) refreshViewLabel(value => value + 1)
  }, [])

  React.useEffect(() => {
    if (!open) return
    commitPreviewView(normalizeDesktopWallpaperView(initialView))
    setDragging(false)
    dragRef.current = null
  }, [commitPreviewView, initialView, open])

  React.useEffect(() => () => {
    if (animationFrameRef.current != null) window.cancelAnimationFrame(animationFrameRef.current)
  }, [])

  const normalizedView = viewRef.current
  const aspectRatio = Math.max(0.1, Math.min(10, Number.isFinite(targetAspect) ? targetAspect : 16 / 9))
  const zoomBy = (factor: number) => commitPreviewView({ ...viewRef.current, scale: viewRef.current.scale * factor })

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md" aria-label="调整桌面壁纸取景">
      <DialogContent sx={{ pt: 1, overflow: 'hidden' }}>
        <Stack spacing={1.25}>
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 1, borderRadius: 2, bgcolor: 'action.hover', border: 1, borderColor: 'divider' }}>
            <Box
              ref={frameRef}
              role="application"
              aria-label="桌面壁纸取景编辑器"
              tabIndex={0}
              onPointerDown={event => {
                const element = frameRef.current
                if (!element) return
                element.setPointerCapture?.(event.pointerId)
                const rect = element.getBoundingClientRect()
                frameSizeRef.current = { width: Math.max(1, rect.width), height: Math.max(1, rect.height) }
                dragRef.current = { x: event.clientX, y: event.clientY, start: normalizeDesktopWallpaperView(viewRef.current) }
                setDragging(true)
              }}
              onPointerMove={event => {
                const drag = dragRef.current
                if (!drag) return
                const dx = event.clientX - drag.x
                const dy = event.clientY - drag.y
                const scale = drag.start.scale
                commitPreviewView({
                  x: drag.start.x - (dx / frameSizeRef.current.width) * (100 / scale),
                  y: drag.start.y - (dy / frameSizeRef.current.height) * (100 / scale),
                  scale,
                }, false)
              }}
              onPointerUp={() => { dragRef.current = null; setDragging(false) }}
              onPointerCancel={() => { dragRef.current = null; setDragging(false) }}
              onWheel={event => {
                event.preventDefault()
                event.stopPropagation()
                commitPreviewView({ ...viewRef.current, scale: viewRef.current.scale * Math.exp(-event.deltaY / 400) })
              }}
              sx={{
                width: 'min(760px, 100%)',
                aspectRatio,
                position: 'relative',
                overflow: 'hidden',
                borderRadius: 1.5,
                bgcolor: '#000',
                outline: 'none',
                cursor: dragging ? 'grabbing' : 'grab',
                touchAction: 'none',
                border: '2px dashed rgba(255,255,255,0.85)',
              }}
            >
              <Box component="img" ref={imageRef} alt="" draggable={false} decoding="async" src={imageUrl} sx={{ ...desktopWallpaperImageStyle(normalizedView), position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', willChange: 'transform, object-position' }} />
            </Box>
          </Box>
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 2, pb: 2, gap: 1, justifyContent: 'space-between' }}>
        <Typography variant="caption" color="text.secondary" sx={{ pl: 1 }}>
          拖拽平移，滚轮缩放｜缩放：{Math.round(normalizedView.scale * 100)}%｜位置：{Math.round(normalizedView.x)}% / {Math.round(normalizedView.y)}%
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <Button size="small" variant="outlined" onClick={() => zoomBy(1 / 1.1)} aria-label="缩小壁纸">缩小</Button>
          <Button size="small" variant="outlined" onClick={() => zoomBy(1.1)} aria-label="放大壁纸">放大</Button>
          <Button size="small" variant="outlined" onClick={() => commitPreviewView(DEFAULT_DESKTOP_WALLPAPER_VIEW)} aria-label="重置壁纸取景">重置</Button>
          <Button size="small" onClick={onClose} variant="outlined">取消</Button>
          <Button size="small" onClick={() => onSave(normalizeDesktopWallpaperView(viewRef.current))} variant="contained" aria-label="保存壁纸取景">保存</Button>
        </Box>
      </DialogActions>
    </Dialog>
  )
}
