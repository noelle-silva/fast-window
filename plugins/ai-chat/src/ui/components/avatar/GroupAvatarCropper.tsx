import * as React from 'react'
import { Box, Button, Paper, Stack, Typography } from '@mui/material'
import { useEvent } from '../../hooks/useEvent'

function clampNum(n: number, min: number, max: number) {
  const x = Number(n)
  if (!isFinite(x)) return min
  if (x < min) return min
  if (x > max) return max
  return x
}

export function GroupAvatarCropper(props: { controller: any; src: string }) {
  const { controller, src } = props
  const api = controller?.api

  const VIEW = 240
  const OUT = 96

  const imgRef = React.useRef<HTMLImageElement | null>(null)
  const dragRef = React.useRef({ active: false, sx: 0, sy: 0, ox: 0, oy: 0 })
  const [natural, setNatural] = React.useState({ w: 0, h: 0 })
  const [zoom, setZoom] = React.useState(1)
  const [offset, setOffset] = React.useState({ x: 0, y: 0 })

  const ready = natural.w > 0 && natural.h > 0
  const base = ready ? Math.max(VIEW / natural.w, VIEW / natural.h) : 1
  const scale = base * zoom
  const drawW = ready ? natural.w * scale : VIEW
  const drawH = ready ? natural.h * scale : VIEW

  const clampOffset = React.useCallback(
    (x: number, y: number) => {
      const maxX = Math.max(0, (drawW - VIEW) / 2)
      const maxY = Math.max(0, (drawH - VIEW) / 2)
      return { x: clampNum(x, -maxX, maxX), y: clampNum(y, -maxY, maxY) }
    },
    [drawW, drawH],
  )

  React.useEffect(() => {
    setOffset((p) => clampOffset(p.x, p.y))
  }, [clampOffset])

  const reset = useEvent(() => {
    setZoom(1)
    setOffset({ x: 0, y: 0 })
  })

  const onImgLoad = useEvent((e: React.SyntheticEvent<HTMLImageElement>) => {
    const el = e.currentTarget
    const w = Number(el.naturalWidth || 0)
    const h = Number(el.naturalHeight || 0)
    setNatural({ w, h })
    setZoom(1)
    setOffset({ x: 0, y: 0 })
  })

  const onPointerDown = useEvent((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const cur = e.currentTarget
    try {
      cur.setPointerCapture(e.pointerId)
    } catch {}
    dragRef.current.active = true
    dragRef.current.sx = e.clientX
    dragRef.current.sy = e.clientY
    dragRef.current.ox = offset.x
    dragRef.current.oy = offset.y
  })

  const onPointerMove = useEvent((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return
    const dx = e.clientX - dragRef.current.sx
    const dy = e.clientY - dragRef.current.sy
    const next = clampOffset(dragRef.current.ox + dx, dragRef.current.oy + dy)
    setOffset(next)
  })

  const onPointerUp = useEvent(() => {
    dragRef.current.active = false
  })

  const onWheel = useEvent((e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault()
    const dir = Number(e.deltaY || 0) > 0 ? -1 : 1
    const factor = dir > 0 ? 1.08 : 1 / 1.08
    setZoom((z) => clampNum(z * factor, 1, 6))
  })

  const cropNow = useEvent(() => {
    try {
      const img = imgRef.current
      if (!img || !ready) return ''

      const imgLeft = (VIEW - drawW) / 2 + offset.x
      const imgTop = (VIEW - drawH) / 2 + offset.y
      const s = VIEW / scale
      const sx = (0 - imgLeft) / scale
      const sy = (0 - imgTop) / scale

      const canvas = document.createElement('canvas')
      canvas.width = OUT
      canvas.height = OUT
      const ctx = canvas.getContext('2d')
      if (!ctx) return ''
      ctx.clearRect(0, 0, OUT, OUT)
      ctx.imageSmoothingEnabled = true
      ;(ctx as any).imageSmoothingQuality = 'high'
      ctx.drawImage(img, sx, sy, s, s, 0, 0, OUT, OUT)

      const out = canvas.toDataURL('image/png')
      return String(out || '').startsWith('data:image/') ? out : ''
    } catch {
      return ''
    }
  })

  const cancelCrop = useEvent(() => {
    controller.actions.setDraft('groupAvatarImageCropSrc', '')
  })

  const applyCrop = useEvent(() => {
    const out = cropNow()
    if (!out) return api?.ui?.showToast?.('裁剪失败')
    controller.actions.setDraft('groupAvatarImage', out)
    controller.actions.setDraft('groupAvatarImageCropSrc', '')
  })

  const imgX = (VIEW - drawW) / 2 + offset.x
  const imgY = (VIEW - drawH) / 2 + offset.y

  return (
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        拖拽移动视角，滚轮缩放；完成后点击“应用”。
      </Typography>
      <Box
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        sx={{
          width: VIEW,
          height: VIEW,
          position: 'relative',
          overflow: 'hidden',
          borderRadius: 2,
          border: '1px solid',
          borderColor: 'divider',
          bgcolor: 'grey.100',
          touchAction: 'none',
          cursor: dragRef.current.active ? 'grabbing' : 'grab',
          mx: 'auto',
        }}
      >
        <Box sx={{ position: 'absolute', inset: 0 }} />
        <img
          ref={imgRef}
          src={src}
          alt="avatar-crop"
          onLoad={onImgLoad}
          draggable={false}
          style={{
            position: 'absolute',
            left: `${imgX}px`,
            top: `${imgY}px`,
            width: `${drawW}px`,
            height: `${drawH}px`,
            userSelect: 'none',
            pointerEvents: 'none',
          }}
        />
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            boxShadow: 'inset 0 0 0 9999px rgba(0,0,0,.25)',
            borderRadius: 2,
          }}
        />
      </Box>

      <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1.5 }}>
        <Button size="small" onClick={reset}>
          重置
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button size="small" onClick={cancelCrop}>
          取消裁剪
        </Button>
        <Button size="small" variant="contained" onClick={applyCrop} disabled={!ready}>
          应用
        </Button>
      </Stack>
    </Paper>
  )
}

