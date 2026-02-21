import { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Button, Dialog, DialogActions, DialogContent, Stack, Typography } from '@mui/material'
import type { WallpaperView } from '../wallpaper'

function clampNumber(v: number, min: number, max: number) {
  if (!Number.isFinite(v)) return min
  return Math.max(min, Math.min(max, v))
}

function normalizeView(view: WallpaperView): WallpaperView {
  return {
    x: clampNumber(view.x, 0, 100),
    y: clampNumber(view.y, 0, 100),
    scale: clampNumber(view.scale, 1, 4),
  }
}

export default function WallpaperViewEditorDialog(props: {
  open: boolean
  imageUrl: string
  targetAspect: number
  initialView: WallpaperView
  onClose: () => void
  onSave: (view: WallpaperView) => void
}) {
  const { open, imageUrl, targetAspect, initialView, onClose, onSave } = props
  const [view, setView] = useState<WallpaperView>(() => normalizeView(initialView))
  const [dragging, setDragging] = useState(false)
  const frameRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{ x: number; y: number; start: WallpaperView } | null>(null)

  const zoomBy = (factor: number) => {
    setView(prev => normalizeView({ ...prev, scale: prev.scale * factor }))
  }

  useEffect(() => {
    if (!open) return
    setView(normalizeView(initialView))
    setDragging(false)
    dragRef.current = null
  }, [open, initialView])

  const aspectRatio = useMemo(() => {
    const v = clampNumber(targetAspect, 0.1, 10)
    return v
  }, [targetAspect])

  const imageStyle = useMemo(() => {
    const v = normalizeView(view)
    return {
      objectPosition: `${v.x}% ${v.y}%`,
      transform: `scale(${v.scale})`,
      transformOrigin: `${v.x}% ${v.y}%`,
    } as const
  }, [view])

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md" aria-label="调整壁纸取景">
      <DialogContent sx={{ pt: 1, overflow: 'hidden' }}>
        <Stack spacing={1.25}>
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'center',
              p: 1,
              borderRadius: 2,
              bgcolor: 'action.hover',
              border: 1,
              borderColor: 'divider',
            }}
          >
            <Box
              ref={frameRef}
              role="application"
              aria-label="壁纸取景编辑器"
              tabIndex={0}
              onPointerDown={e => {
                const el = frameRef.current
                if (!el) return
                el.setPointerCapture?.(e.pointerId)
                dragRef.current = { x: e.clientX, y: e.clientY, start: normalizeView(view) }
                setDragging(true)
              }}
              onPointerMove={e => {
                const el = frameRef.current
                const d = dragRef.current
                if (!el || !d) return
                const rect = el.getBoundingClientRect()
                const dx = e.clientX - d.x
                const dy = e.clientY - d.y
                const scale = clampNumber(d.start.scale, 1, 4)
                const next: WallpaperView = {
                  x: d.start.x - (dx / Math.max(1, rect.width)) * (100 / scale),
                  y: d.start.y - (dy / Math.max(1, rect.height)) * (100 / scale),
                  scale,
                }
                setView(normalizeView(next))
              }}
              onPointerUp={() => {
                dragRef.current = null
                setDragging(false)
              }}
              onPointerCancel={() => {
                dragRef.current = null
                setDragging(false)
              }}
              onWheel={e => {
                e.preventDefault()
                e.stopPropagation()
                const delta = e.deltaY
                const factor = Math.exp(-delta / 400)
                setView(prev => normalizeView({ ...prev, scale: prev.scale * factor }))
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
              <Box
                component="img"
                alt=""
                draggable={false}
                src={imageUrl}
                sx={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  userSelect: 'none',
                  pointerEvents: 'none',
                  ...imageStyle,
                }}
              />
            </Box>
          </Box>
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 2, pb: 2, gap: 1, justifyContent: 'space-between' }}>
        <Typography variant="caption" color="text.secondary" sx={{ pl: 1 }}>
          拖拽平移，滚轮缩放｜缩放：{Math.round(normalizeView(view).scale * 100)}%｜位置：{Math.round(normalizeView(view).x)}% /{' '}
          {Math.round(normalizeView(view).y)}%
        </Typography>

        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <Button size="small" variant="outlined" onClick={() => zoomBy(1 / 1.1)} aria-label="缩小壁纸">
            缩小
          </Button>
          <Button size="small" variant="outlined" onClick={() => zoomBy(1.1)} aria-label="放大壁纸">
            放大
          </Button>
          <Button size="small" variant="outlined" onClick={() => setView({ x: 50, y: 50, scale: 1 })} aria-label="重置壁纸取景">
            重置
          </Button>
          <Button size="small" onClick={onClose} variant="outlined">
            取消
          </Button>
          <Button size="small" onClick={() => onSave(normalizeView(view))} variant="contained" aria-label="保存壁纸取景">
            保存
          </Button>
        </Box>
      </DialogActions>
    </Dialog>
  )
}
