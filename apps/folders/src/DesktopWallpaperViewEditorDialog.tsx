import * as React from 'react'
import { Box, Button, Dialog, DialogActions, DialogContent, Stack, Typography } from '@mui/material'
import { desktopWallpaperImageSx } from './desktopWallpaperImage'
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
  const [view, setView] = React.useState<DesktopWallpaperView>(() => normalizeDesktopWallpaperView(initialView))
  const [dragging, setDragging] = React.useState(false)
  const frameRef = React.useRef<HTMLDivElement | null>(null)
  const dragRef = React.useRef<{ x: number; y: number; start: DesktopWallpaperView } | null>(null)

  React.useEffect(() => {
    if (!open) return
    setView(normalizeDesktopWallpaperView(initialView))
    setDragging(false)
    dragRef.current = null
  }, [initialView, open])

  const normalizedView = normalizeDesktopWallpaperView(view)
  const aspectRatio = Math.max(0.1, Math.min(10, Number.isFinite(targetAspect) ? targetAspect : 16 / 9))
  const zoomBy = (factor: number) => setView(current => normalizeDesktopWallpaperView({ ...current, scale: current.scale * factor }))

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
                dragRef.current = { x: event.clientX, y: event.clientY, start: normalizeDesktopWallpaperView(view) }
                setDragging(true)
              }}
              onPointerMove={event => {
                const element = frameRef.current
                const drag = dragRef.current
                if (!element || !drag) return
                const rect = element.getBoundingClientRect()
                const dx = event.clientX - drag.x
                const dy = event.clientY - drag.y
                const scale = drag.start.scale
                setView(normalizeDesktopWallpaperView({
                  x: drag.start.x - (dx / Math.max(1, rect.width)) * (100 / scale),
                  y: drag.start.y - (dy / Math.max(1, rect.height)) * (100 / scale),
                  scale,
                }))
              }}
              onPointerUp={() => { dragRef.current = null; setDragging(false) }}
              onPointerCancel={() => { dragRef.current = null; setDragging(false) }}
              onWheel={event => {
                event.preventDefault()
                event.stopPropagation()
                setView(current => normalizeDesktopWallpaperView({ ...current, scale: current.scale * Math.exp(-event.deltaY / 400) }))
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
              <Box component="img" alt="" draggable={false} src={imageUrl} sx={{ ...desktopWallpaperImageSx(normalizedView), position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />
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
          <Button size="small" variant="outlined" onClick={() => setView(DEFAULT_DESKTOP_WALLPAPER_VIEW)} aria-label="重置壁纸取景">重置</Button>
          <Button size="small" onClick={onClose} variant="outlined">取消</Button>
          <Button size="small" onClick={() => onSave(normalizedView)} variant="contained" aria-label="保存壁纸取景">保存</Button>
        </Box>
      </DialogActions>
    </Dialog>
  )
}
