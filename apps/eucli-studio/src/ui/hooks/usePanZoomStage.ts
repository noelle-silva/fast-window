import * as React from 'react'
import { MERMAID_VIEWER_ZOOM_MAX, VIEWER_ZOOM_MIN } from '../../core/viewerZoom'
import { clampOffset } from '../utils/clampOffset'
import { useEvent } from './useEvent'

function clampNum(n: number, min: number, max: number) {
  const x = Number(n)
  if (!isFinite(x)) return min
  if (x < min) return min
  if (x > max) return max
  return x
}

// 内容舞台的平移缩放：滚轮以光标为锚点缩放，按住左键拖拽平移，内容变化后自动回到适配视图。
export function usePanZoomStage(options: { active: boolean; contentKey?: unknown; minZoom?: number; maxZoom?: number }) {
  const { active, contentKey } = options
  const minZoom = Number.isFinite(Number(options.minZoom)) ? Number(options.minZoom) : VIEWER_ZOOM_MIN
  const maxZoom = Number.isFinite(Number(options.maxZoom)) ? Number(options.maxZoom) : MERMAID_VIEWER_ZOOM_MAX

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

  const [contentSize, setContentSize] = React.useState<{ w: number; h: number }>({ w: 0, h: 0 })
  const [fitScale, setFitScale] = React.useState(1)
  const [stageSize, setStageSize] = React.useState<{ w: number; h: number }>({ w: 0, h: 0 })
  const [offset, setOffset] = React.useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const offsetRef = React.useRef(offset)
  offsetRef.current = offset

  const [zoom, setZoom] = React.useState(1)
  const zoomRef = React.useRef(zoom)
  zoomRef.current = zoom

  const setZoomValue = useEvent((value: unknown) => {
    const z = clampNum(Number(value), minZoom, maxZoom)
    setZoom(z)
    zoomRef.current = z
  })

  React.useLayoutEffect(() => {
    if (!active) return
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

      const iw = Number(contentSize.w || 0)
      const ih = Number(contentSize.h || 0)
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
  }, [active, stageEl, contentSize.w, contentSize.h])

  React.useEffect(() => {
    if (!active) return

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

      setOffset(clampOffset({ x: d.sl + dx, y: d.st + dy }, stageSize, contentSize, fitScale, zoomRef.current))
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
  }, [active, stageSize.w, stageSize.h, contentSize.w, contentSize.h, fitScale])

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
    const nz = clampNum(nextZoom, minZoom, maxZoom)
    const z0 = Number.isFinite(zoomRef.current) && zoomRef.current > 0 ? zoomRef.current : 1
    if (nz === z0) return
    userInteractedRef.current = true
    const ratio = nz / z0
    const cur = offsetRef.current
    const next = {
      x: Number(localX || 0) - ratio * (Number(localX || 0) - cur.x),
      y: Number(localY || 0) - ratio * (Number(localY || 0) - cur.y),
    }
    setOffset(clampOffset(next, stageSize, contentSize, safeFit, nz))
    setZoom(nz)
    zoomRef.current = nz
  })

  const zoomBy = useEvent((factor: number) => {
    const sw = Number(stageSize.w || 0)
    const sh = Number(stageSize.h || 0)
    zoomAt(sw / 2, sh / 2, zoomRef.current * factor)
  })

  const reset = useEvent(() => {
    userInteractedRef.current = false
    setZoom(1)
    zoomRef.current = 1
    const iw = Number(contentSize.w || 0)
    const ih = Number(contentSize.h || 0)
    const sw = Number(stageSize.w || 0)
    const sh = Number(stageSize.h || 0)
    if (!iw || !ih || !sw || !sh) return setOffset({ x: 0, y: 0 })
    const contentW = iw * safeFit
    const contentH = ih * safeFit
    const cx = Math.floor((sw - contentW) / 2)
    const cy = Math.floor((sh - contentH) / 2)
    setOffset(clampOffset({ x: cx, y: cy }, stageSize, contentSize, safeFit, 1))
  })

  React.useLayoutEffect(() => {
    if (!active) return
    userInteractedRef.current = false
    dragRef.current = null
    dragDownRef.current = null
    dragMovedRef.current = false
  }, [active, contentKey])

  React.useLayoutEffect(() => {
    if (!active) return
    if (userInteractedRef.current) return
    const iw = Number(contentSize.w || 0)
    const ih = Number(contentSize.h || 0)
    const sw = Number(stageSize.w || 0)
    const sh = Number(stageSize.h || 0)
    if (!iw || !ih || !sw || !sh) return

    const contentW = iw * effectiveScale
    const contentH = ih * effectiveScale
    const cx = Math.floor((sw - contentW) / 2)
    const cy = Math.floor((sh - contentH) / 2)
    const next = clampOffset({ x: cx, y: cy }, stageSize, contentSize, safeFit, safeZoom)
    const cur = offsetRef.current
    if (next.x === cur.x && next.y === cur.y) return
    setOffset(next)
  }, [active, stageSize.w, stageSize.h, contentSize.w, contentSize.h, effectiveScale, safeFit, safeZoom])

  React.useEffect(() => {
    if (!active) return
    const el = stageEl
    if (!el) return

    const onWheel = (e: WheelEvent) => {
      if (!contentSize.w || !contentSize.h) return
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
  }, [active, stageEl, stageSize.w, stageSize.h, contentSize.w, contentSize.h, safeFit, zoomAt])

  return {
    setStageRef,
    stageElRef,
    contentSize,
    setContentSize,
    offset,
    effectiveScale,
    dragMovedRef,
    onStageMouseDown,
    zoomBy,
    reset,
    setZoomValue,
  }
}
