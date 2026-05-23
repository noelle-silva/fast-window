import type { PdfPageProxy } from '../../pdf/pdfRuntime'
import type { PdfRenderedPageFrame } from './pdfPageRenderCache'

export type PdfPageRenderBuffer = {
  canvas: HTMLCanvasElement
  width: number
  height: number
  renderTask: { cancel: () => void; promise: Promise<unknown> }
}

export function createPdfPageRenderBuffer(page: PdfPageProxy, scale: number, outputScale: number): PdfPageRenderBuffer {
  const viewport = page.getViewport({ scale })
  const width = Math.floor(viewport.width)
  const height = Math.floor(viewport.height)
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) throw new Error('无法创建 PDF 离屏画布')

  canvas.width = Math.max(1, Math.floor(viewport.width * outputScale))
  canvas.height = Math.max(1, Math.floor(viewport.height * outputScale))
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
  context.setTransform(outputScale, 0, 0, outputScale, 0, 0)
  context.fillStyle = '#fff'
  context.fillRect(0, 0, viewport.width, viewport.height)

  return {
    canvas,
    width,
    height,
    renderTask: page.render({ canvas, canvasContext: context, viewport }),
  }
}

export function createPdfRenderedPageFrame(key: string, pageNumber: number, scale: number, buffer: PdfPageRenderBuffer): PdfRenderedPageFrame {
  return {
    key,
    pageNumber,
    scale,
    canvas: buffer.canvas,
    width: buffer.width,
    height: buffer.height,
    pixelArea: buffer.canvas.width * buffer.canvas.height,
  }
}

export function commitPdfRenderedPageFrame(targetCanvas: HTMLCanvasElement, frame: PdfRenderedPageFrame): void {
  const context = targetCanvas.getContext('2d')
  if (!context) throw new Error('无法提交 PDF 缓存帧')

  targetCanvas.width = frame.canvas.width
  targetCanvas.height = frame.canvas.height
  targetCanvas.style.width = `${frame.width}px`
  targetCanvas.style.height = `${frame.height}px`
  context.setTransform(1, 0, 0, 1, 0, 0)
  context.clearRect(0, 0, targetCanvas.width, targetCanvas.height)
  context.drawImage(frame.canvas, 0, 0)
}
