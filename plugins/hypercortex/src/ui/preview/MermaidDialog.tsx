import * as React from 'react'
import { Box, Chip, Dialog, IconButton, Tooltip, Typography } from '@mui/material'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import CloseIcon from '@mui/icons-material/Close'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import ZoomInIcon from '@mui/icons-material/ZoomIn'
import ZoomOutIcon from '@mui/icons-material/ZoomOut'
import { MERMAID_VIEWER_ZOOM_MAX, VIEWER_ZOOM_MIN } from './viewerZoom'
import { useEvent } from './useEvent'
import { clampOffset } from './clampOffset'
import type { PreviewController } from './usePreviewController'

function clampNum(n: number, min: number, max: number) {
  const x = Number(n)
  if (!isFinite(x)) return min
  if (x < min) return min
  if (x > max) return max
  return x
}

const MERMAID_COPY_IMAGE_MIN_SCALE = 3
const MERMAID_COPY_IMAGE_MAX_SCALE = 6
const MERMAID_COPY_IMAGE_DPR_FACTOR = 3
const MERMAID_COPY_IMAGE_MAX_SIDE = 12288
const MERMAID_COPY_IMAGE_BG = '#ffffff'

function parseSvgSize(raw: string) {
  try {
    const doc = new DOMParser().parseFromString(raw, 'image/svg+xml')
    const root = doc.querySelector('svg') || doc.documentElement
    if (!root) return { w: 0, h: 0 }
    const vb = String(root.getAttribute('viewBox') || '').trim()
    if (vb) {
      const nums = vb
        .split(/[\s,]+/g)
        .map((x) => Number(x))
        .filter((x) => isFinite(x))
      if (nums.length >= 4) return { w: Math.max(0, nums[2]), h: Math.max(0, nums[3]) }
    }
    const w = String(root.getAttribute('width') || '').trim()
    const h = String(root.getAttribute('height') || '').trim()
    if (w.endsWith('%') || h.endsWith('%')) return { w: 0, h: 0 }
    const nw = parseFloat(w)
    const nh = parseFloat(h)
    return { w: Math.max(0, isFinite(nw) ? nw : 0), h: Math.max(0, isFinite(nh) ? nh : 0) }
  } catch (_) {
    return { w: 0, h: 0 }
  }
}

function getMermaidCopyBitmapSize(baseW: number, baseH: number) {
  const exportScale = Math.min(
    MERMAID_COPY_IMAGE_MAX_SCALE,
    Math.max(MERMAID_COPY_IMAGE_MIN_SCALE, Number(window.devicePixelRatio || 1) * MERMAID_COPY_IMAGE_DPR_FACTOR),
  )
  const scaledLongest = Math.max(baseW, baseH) * exportScale
  const fitScale = scaledLongest > MERMAID_COPY_IMAGE_MAX_SIDE ? MERMAID_COPY_IMAGE_MAX_SIDE / scaledLongest : 1
  const pixelScale = exportScale * fitScale
  return {
    width: Math.max(1, Math.round(baseW * pixelScale)),
    height: Math.max(1, Math.round(baseH * pixelScale)),
  }
}

function normalizeSvgForExport(raw: string, baseW: number, baseH: number) {
  const svgDoc = new DOMParser().parseFromString(raw, 'image/svg+xml')
  const root = svgDoc.querySelector('svg') || svgDoc.documentElement
  if (!root) throw new Error('SVG 内容无效')
  if (!root.getAttribute('xmlns')) root.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  if (!root.getAttribute('xmlns:xlink')) root.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')
  root.setAttribute('width', String(baseW))
  root.setAttribute('height', String(baseH))
  if (!String(root.getAttribute('viewBox') || '').trim()) root.setAttribute('viewBox', `0 0 ${baseW} ${baseH}`)
  return new XMLSerializer().serializeToString(root)
}

async function rasterizeSvgToPngDataUrl(svgMarkup: string, width: number, height: number) {
  const blob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    return await new Promise<string>((resolve, reject) => {
      const img = new Image()
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas')
          canvas.width = width
          canvas.height = height
          const ctx = canvas.getContext('2d')
          if (!ctx) return reject(new Error('无法创建画布'))
          ctx.fillStyle = MERMAID_COPY_IMAGE_BG
          ctx.fillRect(0, 0, width, height)
          ctx.imageSmoothingEnabled = true
          ;(ctx as any).imageSmoothingQuality = 'high'
          ctx.drawImage(img, 0, 0, width, height)
          const out = canvas.toDataURL('image/png')
          if (!String(out || '').startsWith('data:image/')) return reject(new Error('导出图片失败'))
          resolve(out)
        } catch (e) {
          reject(e)
        }
      }
      img.onerror = () => reject(new Error('SVG 转图片失败'))
      img.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function writeImageToClipboard(dataUrl: string) {
  const canWebWrite = typeof navigator !== 'undefined' && !!(navigator as any).clipboard && typeof (window as any).ClipboardItem !== 'undefined'
  if (!canWebWrite) throw new Error('当前环境不支持复制图片')

  const blob = await (await fetch(dataUrl)).blob()
  const item = new (window as any).ClipboardItem({ [blob.type || 'image/png']: blob })
  await (navigator as any).clipboard.write([item])
}

export function MermaidDialog(props: { open: boolean; controller: PreviewController; mermaid: any }) {
  const { open, controller, mermaid } = props
  const items = Array.isArray(mermaid?.items) ? mermaid.items : []
  const len = items.length
  const idx = Math.max(0, Math.min(len - 1, Number(mermaid?.index || 0)))
  const svg = len ? String(items[idx]?.svg || '') : ''
  const viewerZoom = Number(mermaid?.scale || 1)

  const stageElRef = React.useRef<HTMLDivElement | null>(null)
  const contentElRef = React.useRef<HTMLDivElement | null>(null)
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

  const [zoom, setZoom] = React.useState(() => clampNum(viewerZoom, VIEWER_ZOOM_MIN, MERMAID_VIEWER_ZOOM_MAX))
  const zoomRef = React.useRef(zoom)
  zoomRef.current = zoom

  React.useEffect(() => {
    if (!open) return
    const z = clampNum(viewerZoom, VIEWER_ZOOM_MIN, MERMAID_VIEWER_ZOOM_MAX)
    setZoom(z)
    zoomRef.current = z
  }, [open, svg, viewerZoom])

  React.useEffect(() => {
    if (!open || !svg) return setContentSize({ w: 0, h: 0 })
    setContentSize(parseSvgSize(svg))
  }, [open, svg])

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
  }, [open, stageEl, contentSize.w, contentSize.h])

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
  }, [open, stageSize.w, stageSize.h, contentSize.w, contentSize.h, fitScale])

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
    const nz = clampNum(nextZoom, VIEWER_ZOOM_MIN, MERMAID_VIEWER_ZOOM_MAX)
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
    controller.actions.mermaidSetScale(nz)
  })

  const zoomBy = useEvent((factor: number) => {
    const sw = Number(stageSize.w || 0)
    const sh = Number(stageSize.h || 0)
    zoomAt(sw / 2, sh / 2, zoomRef.current * factor)
  })

  const onReset = useEvent(() => {
    userInteractedRef.current = false
    setZoom(1)
    zoomRef.current = 1
    controller.actions.mermaidSetScale(1)
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

  const onCopyImage = useEvent(async () => {
    if (!svg) return
    try {
      const liveSvg = contentElRef.current?.querySelector?.('svg') as SVGSVGElement | null
      if (!liveSvg) throw new Error('未找到已渲染的 Mermaid 图')

      const raw = String(new XMLSerializer().serializeToString(liveSvg) || '').trim()
      if (!raw) throw new Error('无法读取 Mermaid 图内容')

      const rect = liveSvg.getBoundingClientRect()
      const parsed = parseSvgSize(raw)
      const baseW = Math.max(Math.round(rect.width || 0), Math.round(parsed.w || 0))
      const baseH = Math.max(Math.round(rect.height || 0), Math.round(parsed.h || 0))
      if (!(baseW > 0 && baseH > 0)) throw new Error('无法确定图片尺寸')

      const svgMarkup = normalizeSvgForExport(raw, baseW, baseH)
      const bitmap = getMermaidCopyBitmapSize(baseW, baseH)
      const dataUrl = await rasterizeSvgToPngDataUrl(svgMarkup, bitmap.width, bitmap.height)
      await writeImageToClipboard(dataUrl)
      controller.toast('已复制图片到剪贴板')
    } catch (e) {
      controller.toast(`复制失败：${String((e as any)?.message || e || '未知错误')}`)
    }
  })

  React.useLayoutEffect(() => {
    if (!open) return
    userInteractedRef.current = false
    dragRef.current = null
    dragDownRef.current = null
    dragMovedRef.current = false
  }, [open, svg])

  React.useLayoutEffect(() => {
    if (!open) return
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
  }, [open, stageSize.w, stageSize.h, contentSize.w, contentSize.h, effectiveScale, safeFit, safeZoom])

  React.useEffect(() => {
    if (!open) return
    const el = stageEl
    if (!el) return

    const onWheel = (e: WheelEvent) => {
      if (!svg) return
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
  }, [open, svg, stageEl, stageSize.w, stageSize.h, contentSize.w, contentSize.h, safeFit, zoomAt])

  const onStageClick = useEvent((e: React.MouseEvent) => {
    if (!open || !svg) return
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

    const iw = Number(contentSize.w || 0) * effectiveScale
    const ih = Number(contentSize.h || 0) * effectiveScale
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
      BackdropProps={{ sx: { bgcolor: 'transparent' } }}
      PaperProps={{ sx: { bgcolor: 'transparent', boxShadow: 'none' } }}
    >
      <Box sx={{ position: 'relative', width: '100vw', height: '100vh', bgcolor: 'rgba(255,255,255,.86)' }}>
        <Box
          ref={setStageRef}
          onMouseDown={onStageMouseDown}
          onClick={onStageClick}
          sx={{
            position: 'absolute',
            inset: 0,
            overflow: 'hidden',
            cursor: svg ? 'grab' : 'default',
            touchAction: 'none',
          }}
        >
          {svg ? (
            <Box sx={{ transform: `translate(${offset.x}px,${offset.y}px)`, display: 'inline-block' }}>
              <Box sx={{ transformOrigin: '0 0', transform: `scale(${effectiveScale})`, display: 'inline-block', pointerEvents: 'none', userSelect: 'none' }}>
                <Box ref={contentElRef} sx={{ display: 'block' }} dangerouslySetInnerHTML={{ __html: svg }} />
              </Box>
            </Box>
          ) : (
            <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Typography color="rgba(0,0,0,.7)">无可预览的 Mermaid</Typography>
            </Box>
          )}
        </Box>

        <Chip
          size="small"
          label={len ? `${idx + 1}/${len}` : '0/0'}
          sx={{ position: 'absolute', left: 12, top: 12, bgcolor: 'rgba(0,0,0,.45)', color: 'rgba(255,255,255,.92)', border: '1px solid rgba(255,255,255,.18)' }}
        />

        <Box sx={{ position: 'absolute', right: 12, top: 10, display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Tooltip title="缩小">
            <IconButton
              aria-label="缩小"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                zoomBy(1 / 1.12)
              }}
              sx={{ bgcolor: 'rgba(0,0,0,.35)', color: 'rgba(255,255,255,.92)', border: '1px solid rgba(255,255,255,.18)', '&:hover': { bgcolor: 'rgba(0,0,0,.48)' } }}
            >
              <ZoomOutIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title="放大">
            <IconButton
              aria-label="放大"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                zoomBy(1.12)
              }}
              sx={{ bgcolor: 'rgba(0,0,0,.35)', color: 'rgba(255,255,255,.92)', border: '1px solid rgba(255,255,255,.18)', '&:hover': { bgcolor: 'rgba(0,0,0,.48)' } }}
            >
              <ZoomInIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title="重置">
            <IconButton
              aria-label="重置"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onReset()
              }}
              sx={{ bgcolor: 'rgba(0,0,0,.35)', color: 'rgba(255,255,255,.92)', border: '1px solid rgba(255,255,255,.18)', '&:hover': { bgcolor: 'rgba(0,0,0,.48)' } }}
            >
              <RestartAltIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title="复制图片">
            <span>
              <IconButton
                aria-label="复制图片"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  void onCopyImage()
                }}
                disabled={!svg}
                sx={{ bgcolor: 'rgba(0,0,0,.35)', color: 'rgba(255,255,255,.92)', border: '1px solid rgba(255,255,255,.18)', '&:hover': { bgcolor: 'rgba(0,0,0,.48)' } }}
              >
                <ContentCopyIcon />
              </IconButton>
            </span>
          </Tooltip>
          <IconButton
            aria-label="关闭"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              controller.actions.closeModal()
            }}
            sx={{ bgcolor: 'rgba(0,0,0,.35)', color: 'rgba(255,255,255,.92)', border: '1px solid rgba(255,255,255,.18)', '&:hover': { bgcolor: 'rgba(0,0,0,.48)' } }}
          >
            <CloseIcon />
          </IconButton>
        </Box>

        <IconButton
          aria-label="上一张"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            controller.actions.mermaidPrev()
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
            controller.actions.mermaidNext()
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
