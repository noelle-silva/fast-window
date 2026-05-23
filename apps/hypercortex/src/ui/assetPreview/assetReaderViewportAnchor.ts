export type AssetReaderViewportAnchor = {
  pageNumber: number
  pageRatioX: number
  pageRatioY: number
  viewportOffsetX: number
  viewportOffsetY: number
}

const PAGE_NUMBER_ATTRIBUTE = 'data-asset-reader-page-number'
const PAGE_SELECTOR = `[${PAGE_NUMBER_ATTRIBUTE}]`

export function getAssetReaderPageNumberProps(pageNumber: number): Record<string, number> {
  return { [PAGE_NUMBER_ATTRIBUTE]: pageNumber }
}

export function getAssetReaderPageSelector(pageNumber: number): string {
  return `[${PAGE_NUMBER_ATTRIBUTE}="${pageNumber}"]`
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(Math.max(value, 0), 1)
}

function pageNumberFromElement(element: HTMLElement): number | null {
  const pageNumber = Number(element.getAttribute(PAGE_NUMBER_ATTRIBUTE))
  return Number.isFinite(pageNumber) && pageNumber > 0 ? pageNumber : null
}

function distanceToRectCenter(rect: DOMRect, clientX: number, clientY: number): number {
  const centerX = rect.left + rect.width / 2
  const centerY = rect.top + rect.height / 2
  return Math.hypot(centerX - clientX, centerY - clientY)
}

function findAnchorPage(surface: HTMLElement, clientX: number, clientY: number): HTMLElement | null {
  const pages = Array.from(surface.querySelectorAll<HTMLElement>(PAGE_SELECTOR))
  const pointedPage = pages.find(page => {
    const rect = page.getBoundingClientRect()
    return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom
  })
  if (pointedPage) return pointedPage

  return pages.reduce<HTMLElement | null>((nearestPage, page) => {
    if (!nearestPage) return page
    const currentDistance = distanceToRectCenter(page.getBoundingClientRect(), clientX, clientY)
    const nearestDistance = distanceToRectCenter(nearestPage.getBoundingClientRect(), clientX, clientY)
    return currentDistance < nearestDistance ? page : nearestPage
  }, null)
}

export function captureAssetReaderViewportAnchor(surface: HTMLElement): AssetReaderViewportAnchor | null {
  const surfaceRect = surface.getBoundingClientRect()
  const clientX = surfaceRect.left + surface.clientWidth / 2
  const clientY = surfaceRect.top + surface.clientHeight / 2
  const page = findAnchorPage(surface, clientX, clientY)
  if (!page) return null

  const pageNumber = pageNumberFromElement(page)
  if (!pageNumber) return null

  const pageRect = page.getBoundingClientRect()
  const safeWidth = Math.max(pageRect.width, 1)
  const safeHeight = Math.max(pageRect.height, 1)

  return {
    pageNumber,
    pageRatioX: clampRatio((clientX - pageRect.left) / safeWidth),
    pageRatioY: clampRatio((clientY - pageRect.top) / safeHeight),
    viewportOffsetX: clientX - surfaceRect.left,
    viewportOffsetY: clientY - surfaceRect.top,
  }
}

export function restoreAssetReaderViewportAnchor(surface: HTMLElement, anchor: AssetReaderViewportAnchor | null): void {
  if (!anchor) return

  const page = surface.querySelector<HTMLElement>(getAssetReaderPageSelector(anchor.pageNumber))
  if (!page) return

  const surfaceRect = surface.getBoundingClientRect()
  const pageRect = page.getBoundingClientRect()
  const anchorClientX = pageRect.left + pageRect.width * anchor.pageRatioX
  const anchorClientY = pageRect.top + pageRect.height * anchor.pageRatioY
  const targetClientX = surfaceRect.left + anchor.viewportOffsetX
  const targetClientY = surfaceRect.top + anchor.viewportOffsetY

  surface.scrollLeft += anchorClientX - targetClientX
  surface.scrollTop += anchorClientY - targetClientY
}
