import * as React from 'react'
import { Box, Button, CircularProgress, IconButton, TextField, Typography } from '@mui/material'
import KeyboardArrowLeftRoundedIcon from '@mui/icons-material/KeyboardArrowLeftRounded'
import KeyboardArrowRightRoundedIcon from '@mui/icons-material/KeyboardArrowRightRounded'
import FitScreenRoundedIcon from '@mui/icons-material/FitScreenRounded'
import ZoomInRoundedIcon from '@mui/icons-material/ZoomInRounded'
import ZoomOutRoundedIcon from '@mui/icons-material/ZoomOutRounded'
import RestartAltRoundedIcon from '@mui/icons-material/RestartAltRounded'
import { createPdfDocumentLoadingTask, type PdfDocumentProxy, type PdfPageProxy } from '../../pdf/pdfRuntime'
import { isPdfRenderCancelled, pdfPageRenderQueue } from '../../pdf/pdfRenderQueue'
import type { AssetPreviewContext } from './registry'
import { attachAssetReaderCtrlWheelZoom } from './assetReaderCtrlWheelZoom'
import { attachAssetReaderWheelPaging } from './assetReaderWheelPaging'
import { getAssetReaderPageNumberProps, getAssetReaderPageSelector, restoreAssetReaderViewportAnchor, type AssetReaderViewportAnchor } from './assetReaderViewportAnchor'
import { AssetPreviewToolbarPortal } from './assetPreviewToolbar'
import { commitPdfRenderedPageFrame, createPdfPageRenderBuffer, createPdfRenderedPageFrame } from './pdfPageRenderBuffer'
import { getPdfPageFrameKey, PdfPageRenderCache, type PdfRenderedPageFrame } from './pdfPageRenderCache'
import { getPdfRenderWindowRequests } from './pdfRenderWindow'
import { getNextPdfSpreadStartPage, getPdfSpreadFitScale, getPdfSpreadStartPage, getPreviousPdfSpreadStartPage, type PdfPageSize, type PdfReaderLayout } from './pdfReaderLayout'
import { useAssetReaderElementSize } from './useAssetReaderElementSize'
import { softButtonSx } from '../pluginUiStyles'

const PDF_SCALE_MIN = 0.2
const PDF_SCALE_MAX = 1
const PDF_SCALE_STEP = 0.15
const DEFAULT_PDF_SCROLL_SCALE = 0.55
const DEFAULT_PDF_SPREAD_ZOOM = 1
const DEFAULT_PDF_READER_LAYOUT: PdfReaderLayout = 'spread'
const PAGE_ESTIMATED_WIDTH = 720
const PAGE_ESTIMATED_HEIGHT = 1018
const PAGE_OBSERVER_ROOT_MARGIN = '900px 0px'
const CANVAS_MAX_AREA = 16_000_000
const CANVAS_MAX_SIDE = 16_384

function clampScale(value: number, minScale = PDF_SCALE_MIN): number {
  if (!Number.isFinite(value)) return minScale
  if (value < minScale) return minScale
  if (value > PDF_SCALE_MAX) return PDF_SCALE_MAX
  return Math.round(value * 100) / 100
}

function parseTargetPage(value: string, maxPage: number): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed)) return null
  return Math.min(Math.max(Math.floor(parsed), 1), Math.max(maxPage, 1))
}

function getCanvasOutputScale(width: number, height: number): number {
  const dpr = window.devicePixelRatio || 1
  const safeWidth = Math.max(1, width)
  const safeHeight = Math.max(1, height)
  const areaLimitScale = Math.sqrt(CANVAS_MAX_AREA / (safeWidth * safeHeight))
  const sideLimitScale = Math.min(CANVAS_MAX_SIDE / safeWidth, CANVAS_MAX_SIDE / safeHeight)
  const scale = Math.min(dpr, areaLimitScale, sideLimitScale)
  return Number.isFinite(scale) && scale > 0 ? scale : 1
}

function usePageVisibility(rootRef: React.RefObject<HTMLDivElement>, pageNumber: number, scale: number, forceVisible = false): [React.RefObject<HTMLDivElement>, boolean] {
  const ref = React.useRef<HTMLDivElement | null>(null)
  const [visible, setVisible] = React.useState(forceVisible || pageNumber === 1)

  React.useEffect(() => {
    if (forceVisible) {
      setVisible(true)
      return
    }
    const el = ref.current
    if (!el) return
    const root = rootRef.current
    if (!root || typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }

    const observer = new IntersectionObserver(
      entries => {
        const entry = entries[0]
        if (entry?.isIntersecting) setVisible(true)
      },
      { root, rootMargin: PAGE_OBSERVER_ROOT_MARGIN, threshold: 0.01 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [forceVisible, pageNumber, rootRef, scale])

  return [ref, visible]
}

function PdfPageFrameView({
  frame,
  pageNumber,
  scale,
  scrollRootRef,
  pageSize,
  visible,
  onVisible,
  forceVisible = false,
  pagePadding = { px: 2, py: 1.5 },
}: {
  frame: PdfRenderedPageFrame | null
  pageNumber: number
  scale: number
  scrollRootRef: React.RefObject<HTMLDivElement>
  pageSize: PdfPageSize
  visible: boolean
  onVisible: () => void
  forceVisible?: boolean
  pagePadding?: { px: number; py: number }
}) {
  const [pageRef, observedVisible] = usePageVisibility(scrollRootRef, pageNumber, scale, forceVisible)
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null)
  const [displayFrame, setDisplayFrame] = React.useState<PdfRenderedPageFrame | null>(frame)

  React.useEffect(() => {
    if (!observedVisible) return
    onVisible()
  }, [observedVisible, onVisible])

  React.useEffect(() => {
    if (!frame) return
    setDisplayFrame(frame)
    const canvas = canvasRef.current
    if (canvas) commitPdfRenderedPageFrame(canvas, frame)
  }, [frame])

  const width = Math.floor(pageSize.width * scale)
  const height = Math.floor(pageSize.height * scale)
  const shouldShowPlaceholder = !displayFrame && visible

  return (
    <Box ref={pageRef} sx={{ display: 'flex', justifyContent: 'center', px: pagePadding.px, py: pagePadding.py }}>
      <Box {...getAssetReaderPageNumberProps(pageNumber)} sx={{ position: 'relative', width, height, flex: '0 0 auto', bgcolor: '#fff', borderRadius: 1, boxShadow: '0 10px 34px rgba(0,0,0,.18)', overflow: 'hidden' }}>
        <canvas ref={canvasRef} aria-label={`PDF 第 ${pageNumber} 页`} style={{ display: displayFrame ? 'block' : 'none' }} />
        {shouldShowPlaceholder ? (
          <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(0,0,0,.42)', bgcolor: '#fffdf8' }}>
            <Typography sx={{ fontSize: 12 }}>第 {pageNumber} 页</Typography>
          </Box>
        ) : null}
      </Box>
    </Box>
  )
}

function PdfSpreadReader({
  scale,
  spreadStartPage,
  pageCount,
  scrollRootRef,
  pageSize,
  getFrame,
  onPageVisible,
}: {
  scale: number
  spreadStartPage: number
  pageCount: number
  scrollRootRef: React.RefObject<HTMLDivElement>
  pageSize: PdfPageSize
  getFrame: (pageNumber: number) => PdfRenderedPageFrame | null
  onPageVisible: (pageNumber: number) => void
}) {
  const pageNumbers = [spreadStartPage, spreadStartPage + 1].filter(pageNumber => pageNumber <= pageCount)

  return (
    <Box sx={{ minWidth: 'max-content', height: '100%', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', gap: 0, px: 0, py: 0 }}>
      {pageNumbers.map(pageNumber => (
        <PdfPageFrameView key={pageNumber} frame={getFrame(pageNumber)} pageNumber={pageNumber} scale={scale} scrollRootRef={scrollRootRef} pageSize={pageSize} visible onVisible={() => onPageVisible(pageNumber)} forceVisible pagePadding={{ px: 0, py: 0 }} />
      ))}
    </Box>
  )
}

function PdfReaderToolbar({
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

export function PdfAssetReader({ blobUrl, toolbarHost }: AssetPreviewContext) {
  const [pdf, setPdf] = React.useState<PdfDocumentProxy | null>(null)
  const [scrollScale, setScrollScale] = React.useState(DEFAULT_PDF_SCROLL_SCALE)
  const [spreadZoom, setSpreadZoom] = React.useState(DEFAULT_PDF_SPREAD_ZOOM)
  const [pageSize, setPageSize] = React.useState<PdfPageSize>({ width: PAGE_ESTIMATED_WIDTH, height: PAGE_ESTIMATED_HEIGHT })
  const [layout, setLayout] = React.useState<PdfReaderLayout>(DEFAULT_PDF_READER_LAYOUT)
  const [spreadStartPage, setSpreadStartPage] = React.useState(1)
  const [targetPage, setTargetPage] = React.useState('1')
  const [error, setError] = React.useState<string | null>(null)
  const [frameVersion, setFrameVersion] = React.useState(0)
  const scaleRef = React.useRef(DEFAULT_PDF_SCROLL_SCALE)
  const updateScaleRef = React.useRef<(scale: number) => void>(() => undefined)
  const minScaleRef = React.useRef(PDF_SCALE_MIN)
  const pendingZoomAnchorRef = React.useRef<AssetReaderViewportAnchor | null>(null)
  const spreadStartPageRef = React.useRef(1)
  const documentKeyRef = React.useRef('')
  const renderCacheRef = React.useRef(new PdfPageRenderCache())
  const inFlightRenderKeysRef = React.useRef(new Set<string>())
  const visiblePagesRef = React.useRef(new Set<number>([1]))
  const { ref: setScrollRootRef, elementRef: scrollRootRef, size: scrollRootSize } = useAssetReaderElementSize<HTMLDivElement>()

  const pageCount = pdf?.numPages || 0
  const spreadFitScale = React.useMemo(() => getPdfSpreadFitScale(pageSize, scrollRootSize), [pageSize, scrollRootSize])
  const spreadScaleMin = Math.min(PDF_SCALE_MIN, spreadFitScale)
  const scale = layout === 'spread' ? clampScale(spreadFitScale * spreadZoom, spreadScaleMin) : scrollScale

  React.useEffect(() => {
    let cancelled = false
    let loadingTask: ReturnType<typeof createPdfDocumentLoadingTask> | null = null
    setPdf(null)
    setError(null)
    setPageSize({ width: PAGE_ESTIMATED_WIDTH, height: PAGE_ESTIMATED_HEIGHT })
    setLayout(DEFAULT_PDF_READER_LAYOUT)
    setScrollScale(DEFAULT_PDF_SCROLL_SCALE)
    setSpreadZoom(DEFAULT_PDF_SPREAD_ZOOM)
    renderCacheRef.current.clear()
    inFlightRenderKeysRef.current.clear()
    visiblePagesRef.current = new Set([1])
    documentKeyRef.current = `${blobUrl}:${Date.now()}`

    ;(async () => {
      try {
        const arrayBuffer = await fetch(blobUrl).then(response => {
          if (!response.ok) throw new Error(`读取 PDF 文件失败：${response.status}`)
          return response.arrayBuffer()
        })
        const bytes = new Uint8Array(arrayBuffer)
        if (cancelled) return
        loadingTask = createPdfDocumentLoadingTask(bytes)
        const nextPdf = await loadingTask.promise
        if (!cancelled) setPdf(nextPdf)
      } catch (e: any) {
        if (!cancelled) setError(String(e?.message || e || 'PDF 文档读取失败'))
      }
    })()

    return () => {
      cancelled = true
      loadingTask?.destroy()
    }
  }, [blobUrl])

  React.useEffect(() => {
    scaleRef.current = scale
  }, [scale])

  React.useEffect(() => {
    if (!pdf) return
    let cancelled = false

    ;(async () => {
      let page: PdfPageProxy | null = null
      try {
        page = await pdf.getPage(1)
        if (cancelled) return
        const viewport = page.getViewport({ scale: 1 })
        setPageSize({ width: viewport.width, height: viewport.height })
      } catch (e: any) {
        if (!cancelled) setError(String(e?.message || e || 'PDF 页面尺寸读取失败'))
      } finally {
        page?.cleanup()
      }
    })()

    return () => {
      cancelled = true
    }
  }, [pdf])

  React.useEffect(() => {
    spreadStartPageRef.current = spreadStartPage
  }, [spreadStartPage])

  const getFrame = React.useCallback((pageNumber: number, requestScale = scale) => {
    return renderCacheRef.current.get(getPdfPageFrameKey(documentKeyRef.current, pageNumber, requestScale))
  }, [scale])

  const renderPageFrame = React.useCallback((pageNumber: number, requestScale: number) => {
    if (!pdf) return
    if (pageNumber < 1 || pageNumber > pdf.numPages) return

    const documentKey = documentKeyRef.current
    const frameKey = getPdfPageFrameKey(documentKey, pageNumber, requestScale)
    if (renderCacheRef.current.get(frameKey) || inFlightRenderKeysRef.current.has(frameKey)) return

    inFlightRenderKeysRef.current.add(frameKey)
    const queuedRender = pdfPageRenderQueue.enqueue(async () => {
      let page: PdfPageProxy | null = null
      try {
        page = await pdf.getPage(pageNumber)
        const viewport = page.getViewport({ scale: requestScale })
        const outputScale = getCanvasOutputScale(viewport.width, viewport.height)
        const buffer = createPdfPageRenderBuffer(page, requestScale, outputScale)
        await buffer.renderTask.promise
        if (documentKeyRef.current !== documentKey) return
        renderCacheRef.current.set(createPdfRenderedPageFrame(frameKey, pageNumber, requestScale, buffer))
        setFrameVersion(value => value + 1)
      } finally {
        page?.cleanup()
        inFlightRenderKeysRef.current.delete(frameKey)
      }
    })

    queuedRender.promise.catch(e => {
      inFlightRenderKeysRef.current.delete(frameKey)
      if (!isPdfRenderCancelled(e)) setError(String(e?.message || e || 'PDF 页面渲染失败'))
    })
  }, [pdf])

  const markPageVisible = React.useCallback((pageNumber: number) => {
    visiblePagesRef.current.add(pageNumber)
    renderPageFrame(pageNumber, scaleRef.current)
  }, [renderPageFrame])

  const updateScale = React.useCallback((nextScale: number) => {
    const nextEffectiveScale = clampScale(nextScale, layout === 'spread' ? spreadScaleMin : PDF_SCALE_MIN)
    scaleRef.current = nextEffectiveScale
    if (layout === 'spread') {
      setSpreadZoom(nextEffectiveScale / spreadFitScale)
      return
    }
    setScrollScale(nextEffectiveScale)
  }, [layout, spreadFitScale, spreadScaleMin])

  React.useEffect(() => {
    updateScaleRef.current = updateScale
    minScaleRef.current = layout === 'spread' ? spreadScaleMin : PDF_SCALE_MIN
  }, [layout, spreadScaleMin, updateScale])

  React.useLayoutEffect(() => {
    const pendingAnchor = pendingZoomAnchorRef.current
    const scrollRoot = scrollRootRef.current
    if (!pendingAnchor || !scrollRoot) return

    pendingZoomAnchorRef.current = null
    restoreAssetReaderViewportAnchor(scrollRoot, pendingAnchor)
  }, [scale, scrollRootRef])

  const scrollToPdfPage = React.useCallback((pageNumber: number) => {
    window.requestAnimationFrame(() => {
      const target = scrollRootRef.current?.querySelector<HTMLElement>(getAssetReaderPageSelector(pageNumber))
      target?.scrollIntoView({ behavior: 'instant', block: 'start' })
    })
  }, [])

  const resetScrollRootViewport = React.useCallback(() => {
    window.requestAnimationFrame(() => {
      const scrollRoot = scrollRootRef.current
      if (!scrollRoot) return
      scrollRoot.scrollLeft = Math.max(0, (scrollRoot.scrollWidth - scrollRoot.clientWidth) / 2)
      scrollRoot.scrollTop = 0
    })
  }, [])

  React.useEffect(() => {
    const scrollRoot = scrollRootRef.current
    if (!scrollRoot) return

    const wheelZoom = attachAssetReaderCtrlWheelZoom({
      surface: scrollRoot,
      getScale: () => scaleRef.current,
      setScale: nextScale => updateScaleRef.current(nextScale),
      onScaleCommitted: anchor => {
        pendingZoomAnchorRef.current = anchor
      },
      step: PDF_SCALE_STEP,
      clampScale: value => clampScale(value, minScaleRef.current),
    })

    return () => wheelZoom.destroy()
  }, [pdf, scrollRootRef])

  const canPreviousSpread = React.useCallback(() => spreadStartPageRef.current > 1, [])
  const canNextSpread = React.useCallback(() => Boolean(pdf && spreadStartPageRef.current + 1 < pdf.numPages), [pdf])

  const updateSpreadStartPage = React.useCallback((nextPage: number) => {
    if (!pdf) return
    const nextSpreadStartPage = getPdfSpreadStartPage(nextPage, pdf.numPages)
    spreadStartPageRef.current = nextSpreadStartPage
    setSpreadStartPage(nextSpreadStartPage)
    setTargetPage(String(nextSpreadStartPage))
  }, [pdf])

  const previousSpread = React.useCallback(() => {
    if (!pdf) return
    updateSpreadStartPage(getPreviousPdfSpreadStartPage(spreadStartPageRef.current, pdf.numPages))
  }, [pdf, updateSpreadStartPage])

  const nextSpread = React.useCallback(() => {
    if (!pdf) return
    updateSpreadStartPage(getNextPdfSpreadStartPage(spreadStartPageRef.current, pdf.numPages))
  }, [pdf, updateSpreadStartPage])

  React.useEffect(() => {
    if (layout !== 'spread') return
    const scrollRoot = scrollRootRef.current
    if (!scrollRoot) return

    const wheelPaging = attachAssetReaderWheelPaging({
      surface: scrollRoot,
      canPrevious: canPreviousSpread,
      canNext: canNextSpread,
      onPreviousPage: previousSpread,
      onNextPage: nextSpread,
      onError: setError,
      errorMessage: 'PDF 滚轮翻页失败',
    })

    return () => wheelPaging.destroy()
  }, [canNextSpread, canPreviousSpread, layout, nextSpread, pdf, previousSpread])

  React.useEffect(() => {
    if (!pdf) return
    setTargetPage('1')
    setSpreadStartPage(1)
    spreadStartPageRef.current = 1
  }, [pdf])

  React.useEffect(() => {
    if (!pdf) return
    const requests = getPdfRenderWindowRequests({
      layout,
      pageCount: pdf.numPages,
      spreadStartPage,
      visiblePages: Array.from(visiblePagesRef.current),
      scale,
      scaleStep: PDF_SCALE_STEP,
      minScale: layout === 'spread' ? spreadScaleMin : PDF_SCALE_MIN,
      maxScale: PDF_SCALE_MAX,
    })
    requests.forEach(request => renderPageFrame(request.pageNumber, request.scale))
  }, [layout, pdf, renderPageFrame, scale, spreadScaleMin, spreadStartPage, frameVersion])

  const changeLayout = React.useCallback((nextLayout: PdfReaderLayout) => {
    if (!pdf) return
    setLayout(nextLayout)
    if (nextLayout === 'spread') {
      const pageNumber = parseTargetPage(targetPage, pdf.numPages) || 1
      updateSpreadStartPage(pageNumber)
    } else {
      const pageNumber = spreadStartPageRef.current
      setTargetPage(String(pageNumber))
      scrollToPdfPage(pageNumber)
    }
  }, [pdf, scrollToPdfPage, targetPage, updateSpreadStartPage])

  const jumpToTargetPage = React.useCallback((event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!pdf) return
    const pageNumber = parseTargetPage(targetPage, pdf.numPages)
    if (!pageNumber) return
    setTargetPage(String(pageNumber))
    if (layout === 'spread') {
      updateSpreadStartPage(pageNumber)
      return
    }
    scrollToPdfPage(pageNumber)
  }, [layout, pdf, scrollToPdfPage, targetPage, updateSpreadStartPage])

  const zoomOut = React.useCallback(() => updateScale(scaleRef.current - PDF_SCALE_STEP), [updateScale])
  const resetZoom = React.useCallback(() => {
    if (layout === 'spread') {
      setSpreadZoom(DEFAULT_PDF_SPREAD_ZOOM)
      scaleRef.current = spreadFitScale
      resetScrollRootViewport()
      return
    }
    updateScale(DEFAULT_PDF_SCROLL_SCALE)
  }, [layout, resetScrollRootViewport, spreadFitScale, updateScale])
  const resetSpreadView = React.useCallback(() => {
    setSpreadZoom(DEFAULT_PDF_SPREAD_ZOOM)
    scaleRef.current = spreadFitScale
    resetScrollRootViewport()
  }, [resetScrollRootViewport, spreadFitScale])
  const zoomIn = React.useCallback(() => updateScale(scaleRef.current + PDF_SCALE_STEP), [updateScale])

  if (error) {
    return (
      <Box sx={{ p: 2, textAlign: 'center' }}>
        <Typography color="error" sx={{ fontSize: 13 }}>{error}</Typography>
      </Box>
    )
  }

  if (!pdf) return <CircularProgress size={20} />

  const pages = Array.from({ length: pdf.numPages }, (_, index) => index + 1)

  return (
    <>
      <AssetPreviewToolbarPortal host={toolbarHost}>
        <PdfReaderToolbar
          pageCount={pageCount}
          scale={scale}
          targetPage={targetPage}
          layout={layout}
          spreadStartPage={spreadStartPage}
          onTargetPageChange={setTargetPage}
          onJumpToTargetPage={jumpToTargetPage}
          onLayoutChange={changeLayout}
          onPreviousSpread={previousSpread}
          onNextSpread={nextSpread}
          onResetSpreadView={resetSpreadView}
          onZoomOut={zoomOut}
          onResetZoom={resetZoom}
          onZoomIn={zoomIn}
        />
      </AssetPreviewToolbarPortal>
      <Box sx={{ position: 'relative', width: '100%', height: '100%', display: 'flex', flexDirection: 'column', bgcolor: '#3f3f46' }}>
        <Box ref={setScrollRootRef} sx={{ flex: 1, minHeight: 0, overflow: layout === 'spread' ? 'hidden' : 'auto', overflowAnchor: 'none', py: layout === 'spread' ? 0 : 2 }}>
          {layout === 'spread' ? (
            <PdfSpreadReader scale={scale} spreadStartPage={spreadStartPage} pageCount={pdf.numPages} scrollRootRef={scrollRootRef} pageSize={pageSize} getFrame={getFrame} onPageVisible={markPageVisible} />
          ) : pages.map(pageNumber => (
            <PdfPageFrameView key={pageNumber} frame={getFrame(pageNumber)} pageNumber={pageNumber} scale={scale} scrollRootRef={scrollRootRef} pageSize={pageSize} visible={visiblePagesRef.current.has(pageNumber)} onVisible={() => markPageVisible(pageNumber)} />
          ))}
        </Box>
      </Box>
    </>
  )
}
