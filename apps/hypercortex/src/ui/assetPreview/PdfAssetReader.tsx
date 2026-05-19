import * as React from 'react'
import { Box, Button, CircularProgress, IconButton, TextField, Typography } from '@mui/material'
import ZoomInRoundedIcon from '@mui/icons-material/ZoomInRounded'
import ZoomOutRoundedIcon from '@mui/icons-material/ZoomOutRounded'
import RestartAltRoundedIcon from '@mui/icons-material/RestartAltRounded'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import pdfWorkerSource from 'pdfjs-dist/legacy/build/pdf.worker.mjs?raw'
import type { AssetPreviewContext } from './registry'
import { AssetPreviewToolbarPortal } from './assetPreviewToolbar'
import { softButtonSx } from '../pluginUiStyles'

type PdfDocumentProxy = Awaited<ReturnType<typeof pdfjsLib.getDocument>['promise']>

const PDF_SCALE_MIN = 0.6
const PDF_SCALE_MAX = 2.4
const PDF_SCALE_STEP = 0.15
const DEFAULT_PDF_SCALE = 1.2
const PAGE_ESTIMATED_WIDTH = 720
const PAGE_ESTIMATED_HEIGHT = 1018
const PAGE_OBSERVER_ROOT_MARGIN = '900px 0px'

let pdfWorkerUrl = ''

function ensurePdfWorker(): void {
  if (pdfWorkerUrl) return
  const source = String(pdfWorkerSource || '')
  if (!source) throw new Error('PDF worker 资源为空')
  const blob = new Blob([source], { type: 'text/javascript' })
  pdfWorkerUrl = URL.createObjectURL(blob)
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
}

function clampScale(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PDF_SCALE
  if (value < PDF_SCALE_MIN) return PDF_SCALE_MIN
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

function usePageVisibility(rootRef: React.RefObject<HTMLDivElement>, pageNumber: number, scale: number): [React.RefObject<HTMLDivElement>, boolean] {
  const ref = React.useRef<HTMLDivElement | null>(null)
  const [visible, setVisible] = React.useState(pageNumber === 1)

  React.useEffect(() => {
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
  }, [pageNumber, rootRef, scale])

  return [ref, visible]
}

function PdfPageCanvas({
  pdf,
  pageNumber,
  scale,
  scrollRootRef,
}: {
  pdf: PdfDocumentProxy
  pageNumber: number
  scale: number
  scrollRootRef: React.RefObject<HTMLDivElement>
}) {
  const [pageRef, visible] = usePageVisibility(scrollRootRef, pageNumber, scale)
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [size, setSize] = React.useState({ width: PAGE_ESTIMATED_WIDTH, height: PAGE_ESTIMATED_HEIGHT })
  const [rendering, setRendering] = React.useState(false)

  React.useEffect(() => {
    if (!visible) return
    let cancelled = false
    let renderTask: { cancel: () => void; promise: Promise<unknown> } | null = null
    setError(null)
    setRendering(true)

    ;(async () => {
      try {
        const page = await pdf.getPage(pageNumber)
        if (cancelled) return
        const viewport = page.getViewport({ scale })
        setSize({ width: Math.floor(viewport.width), height: Math.floor(viewport.height) })
        const canvas = canvasRef.current
        if (!canvas) return
        const context = canvas.getContext('2d')
        if (!context) throw new Error('无法创建 PDF 画布')

        const ratio = window.devicePixelRatio || 1
        canvas.width = Math.floor(viewport.width * ratio)
        canvas.height = Math.floor(viewport.height * ratio)
        canvas.style.width = `${Math.floor(viewport.width)}px`
        canvas.style.height = `${Math.floor(viewport.height)}px`
        context.setTransform(ratio, 0, 0, ratio, 0, 0)
        context.clearRect(0, 0, viewport.width, viewport.height)

        renderTask = page.render({ canvasContext: context, viewport })
        await renderTask.promise
      } catch (e: any) {
        if (!cancelled && String(e?.name || '') !== 'RenderingCancelledException') {
          setError(String(e?.message || e || 'PDF 页面渲染失败'))
        }
      } finally {
        if (!cancelled) setRendering(false)
      }
    })()

    return () => {
      cancelled = true
      renderTask?.cancel()
    }
  }, [pageNumber, pdf, scale, visible])

  return (
    <Box ref={pageRef} data-pdf-page-number={pageNumber} sx={{ display: 'flex', justifyContent: 'center', px: 2, py: 1.5 }}>
      <Box sx={{ position: 'relative', width: size.width, height: size.height, maxWidth: '100%', bgcolor: '#fff', borderRadius: 1, boxShadow: '0 10px 34px rgba(0,0,0,.18)', overflow: 'hidden' }}>
        <canvas ref={canvasRef} aria-label={`PDF 第 ${pageNumber} 页`} style={{ display: visible ? 'block' : 'none' }} />
        {!visible || rendering ? (
          <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(0,0,0,.42)', bgcolor: '#fffdf8' }}>
            <Typography sx={{ fontSize: 12 }}>第 {pageNumber} 页</Typography>
          </Box>
        ) : null}
        {error ? (
          <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'rgba(255,255,255,.9)', p: 2 }}>
            <Typography color="error" sx={{ fontSize: 13 }}>{error}</Typography>
          </Box>
        ) : null}
      </Box>
    </Box>
  )
}

function PdfReaderToolbar({
  pageCount,
  scale,
  targetPage,
  onTargetPageChange,
  onJumpToTargetPage,
  onZoomOut,
  onResetZoom,
  onZoomIn,
}: {
  pageCount: number
  scale: number
  targetPage: string
  onTargetPageChange: (value: string) => void
  onJumpToTargetPage: (event: React.FormEvent<HTMLFormElement>) => void
  onZoomOut: () => void
  onResetZoom: () => void
  onZoomIn: () => void
}) {
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
        {pageCount} 页 · {Math.round(scale * 100)}%
      </Typography>
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
  const [scale, setScale] = React.useState(DEFAULT_PDF_SCALE)
  const [targetPage, setTargetPage] = React.useState('1')
  const [error, setError] = React.useState<string | null>(null)
  const scrollRootRef = React.useRef<HTMLDivElement | null>(null)

  const pageCount = pdf?.numPages || 0

  React.useEffect(() => {
    let cancelled = false
    let loadingTask: ReturnType<typeof pdfjsLib.getDocument> | null = null
    setPdf(null)
    setError(null)

    ;(async () => {
      try {
        ensurePdfWorker()
        const bytes = new Uint8Array(await fetch(blobUrl).then(response => {
          if (!response.ok) throw new Error(`读取 PDF 文件失败：${response.status}`)
          return response.arrayBuffer()
        }))
        if (cancelled) return
        loadingTask = pdfjsLib.getDocument({ data: bytes })
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
    if (pdf) setTargetPage('1')
  }, [pdf])

  const jumpToTargetPage = React.useCallback((event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!pdf) return
    const pageNumber = parseTargetPage(targetPage, pdf.numPages)
    if (!pageNumber) return
    setTargetPage(String(pageNumber))
    const target = scrollRootRef.current?.querySelector<HTMLElement>(`[data-pdf-page-number="${pageNumber}"]`)
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [pdf, targetPage])

  const zoomOut = React.useCallback(() => setScale(v => clampScale(v - PDF_SCALE_STEP)), [])
  const resetZoom = React.useCallback(() => setScale(DEFAULT_PDF_SCALE), [])
  const zoomIn = React.useCallback(() => setScale(v => clampScale(v + PDF_SCALE_STEP)), [])

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
          onTargetPageChange={setTargetPage}
          onJumpToTargetPage={jumpToTargetPage}
          onZoomOut={zoomOut}
          onResetZoom={resetZoom}
          onZoomIn={zoomIn}
        />
      </AssetPreviewToolbarPortal>
      <Box sx={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', bgcolor: '#3f3f46' }}>
        <Box ref={scrollRootRef} sx={{ flex: 1, minHeight: 0, overflow: 'auto', py: 2 }}>
          {pages.map(pageNumber => <PdfPageCanvas key={pageNumber} pdf={pdf} pageNumber={pageNumber} scale={scale} scrollRootRef={scrollRootRef} />)}
        </Box>
      </Box>
    </>
  )
}
