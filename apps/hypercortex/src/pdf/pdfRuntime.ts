import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import pdfWorkerSource from 'pdfjs-dist/legacy/build/pdf.worker.mjs?raw'

export type PdfDocumentProxy = Awaited<ReturnType<typeof pdfjsLib.getDocument>['promise']>
export type PdfPageProxy = Awaited<ReturnType<PdfDocumentProxy['getPage']>>

const PDFJS_ASSET_BASE = 'pdfjs'
const PDF_CANVAS_MAX_AREA_BYTES = 64 * 1024 * 1024

let pdfWorkerUrl = ''

function ensurePdfWorker(): void {
  if (pdfWorkerUrl) return
  const source = String(pdfWorkerSource || '')
  if (!source) throw new Error('PDF worker 资源为空')
  const blob = new Blob([source], { type: 'text/javascript' })
  pdfWorkerUrl = URL.createObjectURL(blob)
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
}

function createPdfAssetUrl(directory: 'cmaps' | 'standard_fonts' | 'wasm'): string {
  const baseUrl = String(import.meta.env.BASE_URL || '/').replace(/\/$/, '')
  return new URL(`${baseUrl}/${PDFJS_ASSET_BASE}/${directory}/`, window.location.href).toString()
}

export function createPdfDocumentLoadingTask(data: Uint8Array): ReturnType<typeof pdfjsLib.getDocument> {
  ensurePdfWorker()
  return pdfjsLib.getDocument({
    data,
    cMapPacked: true,
    cMapUrl: createPdfAssetUrl('cmaps'),
    standardFontDataUrl: createPdfAssetUrl('standard_fonts'),
    wasmUrl: createPdfAssetUrl('wasm'),
    canvasMaxAreaInBytes: PDF_CANVAS_MAX_AREA_BYTES,
  })
}
