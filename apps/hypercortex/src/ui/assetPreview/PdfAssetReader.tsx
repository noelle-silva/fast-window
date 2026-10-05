import * as React from 'react'
import { Box, CircularProgress, Typography } from '@mui/material'
import { createPdfDocumentLoadingTask, type PdfDocumentProxy, type PdfPageProxy } from '../../pdf/pdfRuntime'
import { isPdfRenderCancelled, pdfPageRenderQueue } from '../../pdf/pdfRenderQueue'
import type { AssetPreviewContext } from './registry'
import { attachAssetReaderCtrlWheelZoom } from './assetReaderCtrlWheelZoom'
import { attachAssetReaderWheelPaging } from './assetReaderWheelPaging'
import { getAssetReaderPageSelector, restoreAssetReaderViewportAnchor, type AssetReaderViewportAnchor } from './assetReaderViewportAnchor'
import { AssetPreviewToolbarPortal } from './assetPreviewToolbar'
import { PdfPageFrameView } from './PdfPageFrameView'
import { PdfReaderToolbar } from './PdfReaderToolbar'
import { PdfSpreadReader } from './PdfSpreadReader'
import { createPdfPageRenderBuffer, createPdfRenderedPageFrame } from './pdfPageRenderBuffer'
import { getPdfPageFrameKey, PdfPageRenderCache } from './pdfPageRenderCache'
import { getPdfRenderWindowRequests } from './pdfRenderWindow'
import { getNextPdfSpreadStartPage, getPdfSpreadFitScale, getPdfSpreadStartPage, getPreviousPdfSpreadStartPage, type PdfPageSize, type PdfReaderLayout } from './pdfReaderLayout'
import { useAssetReaderElementSize } from './useAssetReaderElementSize'

const PDF_SCALE_MIN = 0.2
const PDF_SCALE_MAX = 1
const PDF_SCALE_STEP = 0.15
const DEFAULT_PDF_SCROLL_SCALE = 0.55
const DEFAULT_PDF_SPREAD_ZOOM = 1
const DEFAULT_PDF_READER_LAYOUT: PdfReaderLayout = 'spread'
const PAGE_ESTIMATED_WIDTH = 720
const PAGE_ESTIMATED_HEIGHT = 1018
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
