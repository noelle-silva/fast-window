import * as React from 'react'
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from '@mui/material'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import ZoomInIcon from '@mui/icons-material/ZoomIn'
import ZoomOutIcon from '@mui/icons-material/ZoomOut'
import {
  DEFAULT_WALLPAPER_VIEW,
  clampWallpaperFocus,
  clampWallpaperScale,
  type WallpaperPreset,
  type WallpaperView,
} from '../../domain/wallpaper'
import { useEvent } from '../hooks/useEvent'
import { useWallpaperImage } from '../wallpaper/useWallpaperImage'

type DragState = {
  pointerId: number
  pointerX: number
  pointerY: number
  view: WallpaperView
}

export function WallpaperViewEditorDialog(props: { controller: any; open: boolean; preset: WallpaperPreset | null; onClose: () => void }) {
  const { controller, open, preset, onClose } = props
  const [view, setView] = React.useState<WallpaperView>({ ...DEFAULT_WALLPAPER_VIEW })
  const [dragging, setDragging] = React.useState(false)
  const [aspect, setAspect] = React.useState(() => (typeof window === 'undefined' ? 16 / 9 : window.innerWidth / Math.max(1, window.innerHeight)))
  const previewRef = React.useRef<HTMLDivElement | null>(null)
  const dragRef = React.useRef<DragState | null>(null)
  const src = useWallpaperImage(controller, preset?.relPath || '')

  React.useEffect(() => {
    if (!open) return
    setView(preset?.view ? { ...preset.view } : { ...DEFAULT_WALLPAPER_VIEW })
  }, [open, preset?.id])

  React.useEffect(() => {
    const onResize = () => setAspect(window.innerWidth / Math.max(1, window.innerHeight))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // 预览区滚轮缩放：必须用非 passive 监听，避免连带滚动设置页。
  React.useEffect(() => {
    const el = previewRef.current
    if (!el || !open) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      event.stopPropagation()
      const factor = Math.exp(-event.deltaY / 400)
      setView((current) => ({ ...current, scale: clampWallpaperScale(current.scale * factor, current.scale) }))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [open])

  React.useEffect(() => {
    dragRef.current = null
    setDragging(false)
  }, [open])

  const beginDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const el = previewRef.current
    if (!el || event.button !== 0) return
    event.preventDefault()
    try {
      el.setPointerCapture(event.pointerId)
    } catch (_) {}
    dragRef.current = { pointerId: event.pointerId, pointerX: event.clientX, pointerY: event.clientY, view: { ...view } }
    setDragging(true)
  }

  const moveDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    const el = previewRef.current
    if (!drag || !el || drag.pointerId !== event.pointerId) return
    const width = Math.max(1, el.clientWidth)
    const height = Math.max(1, el.clientHeight)
    setView({
      x: clampWallpaperFocus(drag.view.x - ((event.clientX - drag.pointerX) / width) * (100 / drag.view.scale), drag.view.x),
      y: clampWallpaperFocus(drag.view.y - ((event.clientY - drag.pointerY) / height) * (100 / drag.view.scale), drag.view.y),
      scale: drag.view.scale,
    })
  }

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    setDragging(false)
    try {
      previewRef.current?.releasePointerCapture(event.pointerId)
    } catch (_) {}
  }

  const zoomBy = useEvent((factor: number) => setView((current) => ({ ...current, scale: clampWallpaperScale(current.scale * factor, current.scale) })))
  const reset = useEvent(() => setView({ ...DEFAULT_WALLPAPER_VIEW }))
  const save = useEvent(() => {
    if (!preset) return
    controller.actions.setWallpaperView?.(preset.id, view)
    onClose()
  })

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>调整取景</DialogTitle>
      <DialogContent>
        <Stack spacing={1.25} sx={{ pt: 1 }}>
          <Box
            ref={previewRef}
            onPointerDown={beginDrag}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            sx={{
              position: 'relative',
              width: '100%',
              aspectRatio: `${aspect}`,
              maxHeight: 420,
              overflow: 'hidden',
              borderRadius: 2,
              bgcolor: 'var(--studio-paper-muted)',
              cursor: dragging ? 'grabbing' : 'grab',
              touchAction: 'none',
              userSelect: 'none',
            }}
          >
            {src ? (
              <Box
                component="img"
                src={src}
                alt="壁纸取景预览"
                draggable={false}
                sx={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  objectPosition: `${view.x}% ${view.y}%`,
                  transform: `scale(${view.scale})`,
                  transformOrigin: `${view.x}% ${view.y}%`,
                  pointerEvents: 'none',
                }}
              />
            ) : (
              <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
                壁纸图片加载中…
              </Typography>
            )}
          </Box>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
            <Button size="small" startIcon={<ZoomOutIcon />} onClick={() => zoomBy(1 / 1.1)}>
              缩小
            </Button>
            <Button size="small" startIcon={<ZoomInIcon />} onClick={() => zoomBy(1.1)}>
              放大
            </Button>
            <Button size="small" startIcon={<RestartAltIcon />} onClick={reset}>
              重置
            </Button>
            <Box sx={{ flex: 1 }} />
            <Typography variant="caption" color="text.secondary">
              缩放 {view.scale.toFixed(2)}× ・ 位置 {Math.round(view.x)}% / {Math.round(view.y)}%
            </Typography>
          </Stack>

          <Typography variant="caption" color="text.secondary">
            拖拽平移，滚轮缩放；保存后立即生效。
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button variant="text" color="inherit" onClick={onClose}>
          取消
        </Button>
        <Button variant="contained" onClick={save} disabled={!preset}>
          保存
        </Button>
      </DialogActions>
    </Dialog>
  )
}
