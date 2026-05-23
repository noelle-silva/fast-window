import { getNextPdfSpreadStartPage, getPreviousPdfSpreadStartPage, type PdfReaderLayout } from './pdfReaderLayout'

export type PdfRenderRequest = {
  pageNumber: number
  scale: number
  priority: number
}

type PdfRenderWindowOptions = {
  layout: PdfReaderLayout
  pageCount: number
  spreadStartPage: number
  visiblePages: number[]
  scale: number
  scaleStep: number
  minScale: number
  maxScale: number
}

function addPageNumbers(target: Set<number>, pageCount: number, pageNumbers: number[]): void {
  pageNumbers.forEach(pageNumber => {
    if (pageNumber >= 1 && pageNumber <= pageCount) target.add(pageNumber)
  })
}

function spreadPages(spreadStartPage: number): number[] {
  return [spreadStartPage, spreadStartPage + 1]
}

function getScaleBuckets(scale: number, scaleStep: number, minScale: number, maxScale: number): number[] {
  const buckets = [scale, scale - scaleStep, scale + scaleStep]
    .map(value => Math.min(Math.max(value, minScale), maxScale))
    .map(value => Math.round(value * 1000) / 1000)
  return Array.from(new Set(buckets))
}

export function getPdfRenderWindowRequests({
  layout,
  pageCount,
  spreadStartPage,
  visiblePages,
  scale,
  scaleStep,
  minScale,
  maxScale,
}: PdfRenderWindowOptions): PdfRenderRequest[] {
  const primaryPages = new Set<number>()
  const warmPages = new Set<number>()

  if (layout === 'spread') {
    const previousSpreadStart = getPreviousPdfSpreadStartPage(spreadStartPage, pageCount)
    const nextSpreadStart = getNextPdfSpreadStartPage(spreadStartPage, pageCount)
    addPageNumbers(primaryPages, pageCount, spreadPages(spreadStartPage))
    addPageNumbers(warmPages, pageCount, spreadPages(previousSpreadStart))
    addPageNumbers(warmPages, pageCount, spreadPages(nextSpreadStart))
  } else {
    addPageNumbers(primaryPages, pageCount, visiblePages)
    visiblePages.forEach(pageNumber => addPageNumbers(warmPages, pageCount, [pageNumber - 1, pageNumber + 1]))
  }

  const scaleBuckets = getScaleBuckets(scale, scaleStep, minScale, maxScale)
  const requests: PdfRenderRequest[] = []
  const seen = new Set<string>()

  const pushRequest = (pageNumber: number, requestScale: number, priority: number) => {
    const key = `${pageNumber}:${requestScale}`
    if (seen.has(key)) return
    seen.add(key)
    requests.push({ pageNumber, scale: requestScale, priority })
  }

  primaryPages.forEach(pageNumber => pushRequest(pageNumber, scaleBuckets[0], 0))
  primaryPages.forEach(pageNumber => scaleBuckets.slice(1).forEach(requestScale => pushRequest(pageNumber, requestScale, 1)))
  warmPages.forEach(pageNumber => pushRequest(pageNumber, scaleBuckets[0], 2))
  warmPages.forEach(pageNumber => scaleBuckets.slice(1).forEach(requestScale => pushRequest(pageNumber, requestScale, 3)))

  return requests.sort((a, b) => a.priority - b.priority)
}
