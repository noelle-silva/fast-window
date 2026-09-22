import * as React from 'react'
import { Box, Chip, Dialog, IconButton, Tooltip, Typography } from '@mui/material'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import CloseIcon from '@mui/icons-material/Close'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import ZoomInIcon from '@mui/icons-material/ZoomIn'
import ZoomOutIcon from '@mui/icons-material/ZoomOut'
import { MERMAID_VIEWER_ZOOM_MAX } from '../../core/viewerZoom'
import { exportSvgElementToPngDataUrl, parseSvgSize } from '../../render/mermaidExport'
import { useEvent } from '../hooks/useEvent'
import { usePanZoomStage } from '../hooks/usePanZoomStage'

export function MermaidDialog(props: { open: boolean; controller: any; mermaid: any }) {
  const { open, controller, mermaid } = props
  const items = Array.isArray(mermaid?.items) ? mermaid.items : []
  const len = items.length
  const idx = Math.max(0, Math.min(len - 1, Number(mermaid?.index || 0)))
  const svg = len ? String(items[idx]?.svg || '') : ''
  const viewerZoom = Number(mermaid?.scale || 1)

  const contentElRef = React.useRef<HTMLDivElement | null>(null)
  const {
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
  } = usePanZoomStage({ active: open, contentKey: svg, maxZoom: MERMAID_VIEWER_ZOOM_MAX })

  React.useEffect(() => {
    if (!open) return
    setZoomValue(viewerZoom)
  }, [open, svg, viewerZoom, setZoomValue])

  React.useEffect(() => {
    if (!open || !svg) return setContentSize({ w: 0, h: 0 })
    setContentSize(parseSvgSize(svg))
  }, [open, svg, setContentSize])

  const onCopyImage = useEvent(async () => {
    if (!svg) return
    try {
      const liveSvg = contentElRef.current?.querySelector?.('svg') as SVGSVGElement | null
      if (!liveSvg) throw new Error('未找到已渲染的 Mermaid 图')

      const dataUrl = await exportSvgElementToPngDataUrl(liveSvg)
      await controller.capabilities?.clipboard?.writeImage?.(dataUrl)
      controller.capabilities?.ui?.showToast?.('已复制图片到剪贴板', { kind: 'success' })
    } catch (e) {
      controller.capabilities?.ui?.showToast?.(`复制失败：${String((e as any)?.message || e || '未知错误')}`, { kind: 'error' })
    }
  })

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
    const x0 = Number(offset.x || 0)
    const y0 = Number(offset.y || 0)
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
                reset()
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
