export type PdfRenderedPageFrame = {
  key: string
  pageNumber: number
  scale: number
  canvas: HTMLCanvasElement
  width: number
  height: number
  pixelArea: number
}

type PdfPageRenderCacheEntry = {
  frame: PdfRenderedPageFrame
  lastUsedAt: number
}

const DEFAULT_MAX_PIXEL_AREA = 160_000_000

export function getPdfPageFrameKey(documentKey: string, pageNumber: number, scale: number): string {
  return `${documentKey}:${pageNumber}:${Math.round(scale * 1000)}`
}

export class PdfPageRenderCache {
  private readonly entries = new Map<string, PdfPageRenderCacheEntry>()
  private readonly maxPixelArea: number
  private totalPixelArea = 0

  constructor(maxPixelArea = DEFAULT_MAX_PIXEL_AREA) {
    this.maxPixelArea = maxPixelArea
  }

  get(key: string): PdfRenderedPageFrame | null {
    const entry = this.entries.get(key)
    if (!entry) return null
    entry.lastUsedAt = performance.now()
    return entry.frame
  }

  set(frame: PdfRenderedPageFrame): void {
    const existing = this.entries.get(frame.key)
    if (existing) this.totalPixelArea -= existing.frame.pixelArea

    this.entries.set(frame.key, { frame, lastUsedAt: performance.now() })
    this.totalPixelArea += frame.pixelArea
    this.trim()
  }

  clear(): void {
    this.entries.clear()
    this.totalPixelArea = 0
  }

  private trim(): void {
    if (this.totalPixelArea <= this.maxPixelArea) return

    const entriesByAge = Array.from(this.entries.entries()).sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt)
    for (const [key, entry] of entriesByAge) {
      if (this.totalPixelArea <= this.maxPixelArea) return
      this.entries.delete(key)
      this.totalPixelArea -= entry.frame.pixelArea
    }
  }
}
