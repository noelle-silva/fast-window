import * as React from 'react'
import { Box, Dialog, IconButton, Typography } from '@mui/material'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import { IMAGE_VIEWER_ZOOM_MAX, VIEWER_ZOOM_MIN } from '../../core/viewerZoom'
import { useEvent } from '../hooks/useEvent'
import { clampOffset } from '../utils/clampOffset'

function clampNum(n: number, min: number, max: number) {
  const x = Number(n)
  if (!isFinite(x)) return min
  if (x < min) return min
  if (x > max) return max
  return x
}

export function ImageDialog(props: { open: boolean; controller: any; viewer: any }) {
  const { open, controller, viewer } = props
  const items = Array.isArray(viewer?.items) ? viewer.items : []
  const len = items.length
  const idx = Math.max(0, Math.min(len - 1, Number(viewer?.index || 0)))
  const src = len ? String(items[idx]?.src || '') : ''
  const alt = len ? String(items[idx]?.alt || '图片') : '图片'
  const viewerZoom = Number(viewer?.scale || 1)

  const stageElRef = React.useRef<HTMLDivElement | null>(null)
  const [stageEl, setStageEl] = React.useState<HTMLDivElement | null>(null)
  const setStageRef = React.useCallback((node: HTMLDivElement | null) => {
    stageElRef.current = node
    setStageEl(node)
  }, [])
  const dragRef = React.useRef<null | { x: number; y: number; sl: number; st: number; el: HTMLElement }>(null)
  const dragMovedRef = React.useRef(false)
  const dragDownRef = React.useRef<{ x: number; y: number } | null>(null)
  const userInteractedRef = React.useRef(false)
  const [imgSize, setImgSize] = React.useState<{ w: number; h: number }>({ w: 0, h: 0 })
  const [fitScale, setFitScale] = React.useState(1)
  const [stageSize, setStageSize] = React.useState<{ w: number; h: number }>({ w: 0, h: 0 })
  const [offset, setOffset] = React.useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const offsetRef = React.useRef(offset)
  offsetRef.current = offset

  const [zoom, setZoom] = React.useState(() => clampNum(viewerZoom, VIEWER_ZOOM_MIN, IMAGE_VIEWER_ZOOM_MAX))
  const zoomRef = React.useRef(zoom)
  zoomRef.current = zoom

  React.useEffect(() => {
    if (!open) return
    const z = clampNum(viewerZoom, VIEWER_ZOOM_MIN, IMAGE_VIEWER_ZOOM_MAX)
    setZoom(z)
    zoomRef.current = z
  }, [open, src, viewerZoom])

  React.useEffect(() => {
    if (!open || !src) return
    let alive = true
    const img = new Image()
    img.onload = () => {
      if (!alive) return
      setImgSize({ w: Number(img.naturalWidth || 0), h: Number(img.naturalHeight || 0) })
    }
    img.onerror = () => {
      if (!alive) return
      setImgSize({ w: 0, h: 0 })
    }
    img.src = src
    return () => {
      alive = false
    }
  }, [open, src])

  React.useLayoutEffect(() => {
    if (!open) return
    const el = stageEl
    if (!el) return

    const calcFit = () => {
      const FIT_PAD = 0.92
      let w = Number(el.clientWidth || 0)
      let h = Number(el.clientHeight || 0)

      try {
        const cs = window.getComputedStyle(el)
        const px = parseFloat(cs.paddingLeft || '0') + parseFloat(cs.paddingRight || '0')
        const py = parseFloat(cs.paddingTop || '0') + parseFloat(cs.paddingBottom || '0')
        w = w - (isFinite(px) ? px : 0)
        h = h - (isFinite(py) ? py : 0)
      } catch (_) {}

      w = Math.max(0, w)
      h = Math.max(0, h)
      setStageSize({ w, h })
      if (!w || !h) return setFitScale(1)

      const iw = Number(imgSize.w || 0)
      const ih = Number(imgSize.h || 0)
      if (!iw || !ih) return setFitScale(1)

      let s = Math.min(w / iw, h / ih)
      if (s < 1) s = s * FIT_PAD
      s = Math.min(s, 1)
      setFitScale(isFinite(s) && s > 0 ? s : 1)
    }

    calcFit()

    if (typeof ResizeObserver === 'undefined') {
      let cancelled = false
      let raf = 0
      let tries = 0
      const tick = () => {
        if (cancelled) return
        tries += 1
        calcFit()
        if (tries < 10) raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
      return () => {
        cancelled = true
        cancelAnimationFrame(raf)
      }
    }

    const ro = new ResizeObserver(() => calcFit())
    ro.observe(el)
    return () => ro.disconnect()
  }, [open, stageEl, imgSize.w, imgSize.h])

  React.useEffect(() => {
    if (!open) return

      const onMove = (e: MouseEvent) => {
        const d = dragRef.current
        if (!d) return
        e.preventDefault()
        const dx = Number(e.clientX || 0) - d.x
        const dy = Number(e.clientY || 0) - d.y

       if (!dragMovedRef.current) {
         if (Math.abs(dx) + Math.abs(dy) > 3) {
           dragMovedRef.current = true
           userInteractedRef.current = true
         }
       }

      setOffset(clampOffset({ x: d.sl + dx, y: d.st + dy }, stageSize, imgSize, fitScale, zoomRef.current))
    }
    const onUp = () => {
      dragRef.current = null
      dragDownRef.current = null
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('blur', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('blur', onUp)
    }
  }, [open, stageSize.w, stageSize.h, imgSize.w, imgSize.h, fitScale])

  const onStageMouseDown = useEvent((e: React.MouseEvent) => {
    if (e.button !== 0) return
    const el = stageElRef.current
    if (!el) return
    e.preventDefault()
    dragMovedRef.current = false
    dragDownRef.current = { x: Number(e.clientX || 0), y: Number(e.clientY || 0) }
    dragRef.current = { x: Number(e.clientX || 0), y: Number(e.clientY || 0), sl: offsetRef.current.x, st: offsetRef.current.y, el }
  })

  const safeFit = isFinite(fitScale) && fitScale > 0 ? fitScale : 1
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
  const effectiveScale = safeFit * safeZoom

  const zoomAt = useEvent((localX: number, localY: number, nextZoom: number) => {
    const nz = clampNum(nextZoom, VIEWER_ZOOM_MIN, IMAGE_VIEWER_ZOOM_MAX)
    const z0 = Number.isFinite(zoomRef.current) && zoomRef.current > 0 ? zoomRef.current : 1
    if (nz === z0) return
    userInteractedRef.current = true
    const ratio = nz / z0
    const cur = offsetRef.current
    const next = {
      x: Number(localX || 0) - ratio * (Number(localX || 0) - cur.x),
      y: Number(localY || 0) - ratio * (Number(localY || 0) - cur.y),
    }
    setOffset(clampOffset(next, stageSize, imgSize, safeFit, nz))
    setZoom(nz)
    zoomRef.current = nz
    controller.actions.imageSetScale(nz)
  })

  React.useLayoutEffect(() => {
    if (!open) return
    userInteractedRef.current = false
    dragRef.current = null
    dragDownRef.current = null
    dragMovedRef.current = false
  }, [open, src])

  React.useLayoutEffect(() => {
    if (!open) return
    if (userInteractedRef.current) return
    const iw = Number(imgSize.w || 0)
    const ih = Number(imgSize.h || 0)
    const sw = Number(stageSize.w || 0)
    const sh = Number(stageSize.h || 0)
    if (!iw || !ih || !sw || !sh) return

    const contentW = iw * effectiveScale
    const contentH = ih * effectiveScale
    const cx = Math.floor((sw - contentW) / 2)
    const cy = Math.floor((sh - contentH) / 2)
    const next = clampOffset({ x: cx, y: cy }, stageSize, imgSize, safeFit, safeZoom)
    const cur = offsetRef.current
    if (next.x === cur.x && next.y === cur.y) return
    setOffset(next)
  }, [open, stageSize.w, stageSize.h, imgSize.w, imgSize.h, effectiveScale, safeFit, safeZoom])

  React.useEffect(() => {
    if (!open) return
    const el = stageEl
    if (!el) return

    const onWheel = (e: WheelEvent) => {
      if (!src) return
      const dy = Number(e.deltaY || 0)
      if (!isFinite(dy) || dy === 0) return

      e.preventDefault()
      e.stopPropagation()
      userInteractedRef.current = true

      let localX = 0
      let localY = 0
      try {
        const r = el.getBoundingClientRect()
        localX = Number(e.clientX || 0) - r.left
        localY = Number(e.clientY || 0) - r.top

        const cs = window.getComputedStyle(el)
        const pl = parseFloat(cs.paddingLeft || '0')
        const pt = parseFloat(cs.paddingTop || '0')
        localX -= isFinite(pl) ? pl : 0
        localY -= isFinite(pt) ? pt : 0
      } catch (_) {}

      const factor = dy < 0 ? 1.12 : 1 / 1.12
      zoomAt(localX, localY, zoomRef.current * factor)
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel as any)
  }, [open, src, stageEl, stageSize.w, stageSize.h, imgSize.w, imgSize.h, safeFit, zoomAt])

  const onStageClick = useEvent((e: React.MouseEvent) => {
    if (!open || !src) return
    if (!(e.target instanceof Element)) return
    if (e.target.closest('button,[role=\"button\"]')) return
    if (dragMovedRef.current) return

    const el = stageElRef.current
    if (!el) return

    let localX = 0
    let localY = 0
    try {
      const r = el.getBoundingClientRect()
      localX = Number(e.clientX || 0) - r.left
      localY = Number(e.clientY || 0) - r.top
    } catch (_) {}

    const iw = Number(imgSize.w || 0) * effectiveScale
    const ih = Number(imgSize.h || 0) * effectiveScale
    const x0 = Number(offsetRef.current.x || 0)
    const y0 = Number(offsetRef.current.y || 0)
    const inside = iw > 0 && ih > 0 && localX >= x0 && localX <= x0 + iw && localY >= y0 && localY <= y0 + ih
    if (inside) return

    controller.actions.closeModal()
  })

  return (
    <Dialog
      open={open}
      onClose={() => controller.actions.closeModal()}
      fullScreen
      PaperProps={{ sx: { bgcolor: 'transparent', boxShadow: 'none' } }}
    >
      <Box sx={{ position: 'relative', width: '100vw', height: '100vh', bgcolor: 'rgba(0,0,0,.86)' }}>
        <Box
          ref={setStageRef}
          onMouseDown={onStageMouseDown}
          onClick={onStageClick}
          sx={{
            position: 'absolute',
            inset: 0,
            overflow: 'hidden',
            cursor: src ? 'grab' : 'default',
            touchAction: 'none',
          }}
        >
          {src ? (
            <Box sx={{ transform: `translate(${offset.x}px,${offset.y}px)`, display: 'inline-block' }}>
              <Box sx={{ transformOrigin: '0 0', transform: `scale(${effectiveScale})`, display: 'inline-block' }}>
                <Box
                  component="img"
                  src={src}
                  alt={alt}
                  draggable={false}
                  sx={{
                    display: 'block',
                    width: imgSize.w ? `${imgSize.w}px` : 'auto',
                    height: imgSize.h ? `${imgSize.h}px` : 'auto',
                    userSelect: 'none',
                    pointerEvents: 'none',
                  }}
                />
              </Box>
            </Box>
          ) : (
            <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Typography color="rgba(255,255,255,.7)">无可预览的图片</Typography>
            </Box>
          )}
        </Box>

        <IconButton
          aria-label="上一张"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            controller.actions.imagePrev()
          }}
          disabled={len <= 1}
          sx={{
            position: 'absolute',
            left: 16,
            top: '50%',
            transform: 'translateY(-50%)',
            bgcolor: 'rgba(0,0,0,.35)',
            color: 'rgba(255,255,255,.92)',
            border: '1px solid rgba(255,255,255,.18)',
            '&:hover': { bgcolor: 'rgba(0,0,0,.48)' },
          }}
        >
          <ChevronLeftIcon />
        </IconButton>

        <IconButton
          aria-label="下一张"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            controller.actions.imageNext()
          }}
          disabled={len <= 1}
          sx={{
            position: 'absolute',
            right: 16,
            top: '50%',
            transform: 'translateY(-50%)',
            bgcolor: 'rgba(0,0,0,.35)',
            color: 'rgba(255,255,255,.92)',
            border: '1px solid rgba(255,255,255,.18)',
            '&:hover': { bgcolor: 'rgba(0,0,0,.48)' },
          }}
        >
          <ChevronRightIcon />
        </IconButton>
      </Box>
    </Dialog>
  )
}

