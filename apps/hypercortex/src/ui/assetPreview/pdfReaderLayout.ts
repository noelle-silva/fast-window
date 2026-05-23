export type PdfReaderLayout = 'scroll' | 'spread'

export type PdfPageSize = {
  width: number
  height: number
}

export type PdfReaderViewportSize = {
  width: number
  height: number
}

export function getPdfSpreadStartPage(pageNumber: number, pageCount: number): number {
  const safePageCount = Math.max(1, Math.floor(pageCount))
  const safePage = Math.min(Math.max(Math.floor(pageNumber), 1), safePageCount)
  return safePage % 2 === 0 ? safePage - 1 : safePage
}

export function getNextPdfSpreadStartPage(spreadStartPage: number, pageCount: number): number {
  return getPdfSpreadStartPage(Math.min(spreadStartPage + 2, Math.max(pageCount, 1)), pageCount)
}

export function getPreviousPdfSpreadStartPage(spreadStartPage: number, pageCount: number): number {
  return getPdfSpreadStartPage(Math.max(spreadStartPage - 2, 1), pageCount)
}

export function getPdfSpreadFitScale(pageSize: PdfPageSize, viewportSize: PdfReaderViewportSize): number {
  if (!Number.isFinite(pageSize.width) || !Number.isFinite(pageSize.height) || pageSize.width <= 0 || pageSize.height <= 0) return 1
  if (!Number.isFinite(viewportSize.height) || viewportSize.height <= 0) return 1

  const availableHeight = Math.max(1, viewportSize.height)
  const fitScale = availableHeight / pageSize.height
  return Math.min(Math.max(fitScale, 0.01), 1)
}
