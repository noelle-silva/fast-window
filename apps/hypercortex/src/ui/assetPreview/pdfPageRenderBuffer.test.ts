// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { commitPdfRenderedPageFrame, createPdfPageRenderBuffer, createPdfRenderedPageFrame } from './pdfPageRenderBuffer'
import type { PdfPageProxy } from '../../pdf/pdfRuntime'
import type { PdfRenderedPageFrame } from './pdfPageRenderCache'

/**
 * 行为锁定测试（084 · 拆分期护栏）：
 * 用受控的 2D 上下文替身锁定离屏缓冲的尺寸、样式、绘制指令与错误信息。
 */

function fakeContext(): CanvasRenderingContext2D {
  return {
    setTransform: vi.fn(),
    fillRect: vi.fn(),
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    fillStyle: '',
  } as unknown as CanvasRenderingContext2D
}

function fakePage(viewport: { width: number; height: number }) {
  const renderTask = { cancel: vi.fn(), promise: Promise.resolve() }
  const render = vi.fn(() => renderTask)
  const page = {
    getViewport: vi.fn(() => viewport),
    render,
  } as unknown as PdfPageProxy
  return { page, render, renderTask }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createPdfPageRenderBuffer', () => {
  it('creates an offscreen buffer sized to the scaled viewport', () => {
    const context = fakeContext()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D)
    const { page, render, renderTask } = fakePage({ width: 100, height: 200 })

    const buffer = createPdfPageRenderBuffer(page, 2, 1.5)

    expect(page.getViewport).toHaveBeenCalledWith({ scale: 2 })
    expect(buffer.width).toBe(100)
    expect(buffer.height).toBe(200)
    expect(buffer.canvas.width).toBe(150)
    expect(buffer.canvas.height).toBe(300)
    expect(buffer.canvas.style.width).toBe('100px')
    expect(buffer.canvas.style.height).toBe('200px')
    expect(context.setTransform).toHaveBeenCalledWith(1.5, 0, 0, 1.5, 0, 0)
    expect(context.fillStyle).toBe('#fff')
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 100, 200)
    expect(render).toHaveBeenCalledWith({ canvas: buffer.canvas, canvasContext: context, viewport: { width: 100, height: 200 } })
    expect(buffer.renderTask).toBe(renderTask)
  })

  it('clamps a zero-size viewport canvas to one pixel', () => {
    const context = fakeContext()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D)
    const { page } = fakePage({ width: 0, height: 0 })

    const buffer = createPdfPageRenderBuffer(page, 1, 1)

    expect(buffer.width).toBe(0)
    expect(buffer.height).toBe(0)
    expect(buffer.canvas.width).toBe(1)
    expect(buffer.canvas.height).toBe(1)
    expect(buffer.canvas.style.width).toBe('0px')
    expect(buffer.canvas.style.height).toBe('0px')
  })

  it('throws when the offscreen 2d context is unavailable', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const { page } = fakePage({ width: 10, height: 10 })

    expect(() => createPdfPageRenderBuffer(page, 1, 1)).toThrow('无法创建 PDF 离屏画布')
  })
})

describe('createPdfRenderedPageFrame', () => {
  it('derives the frame from the buffer and the canvas pixel area', () => {
    const canvas = { width: 30, height: 40 } as HTMLCanvasElement
    const buffer = { canvas, width: 10, height: 20, renderTask: { cancel: vi.fn(), promise: Promise.resolve() } }

    const frame = createPdfRenderedPageFrame('k', 3, 1.5, buffer)

    expect(frame.key).toBe('k')
    expect(frame.pageNumber).toBe(3)
    expect(frame.scale).toBe(1.5)
    expect(frame.canvas).toBe(canvas)
    expect(frame.width).toBe(10)
    expect(frame.height).toBe(20)
    expect(frame.pixelArea).toBe(1200)
  })
})

describe('commitPdfRenderedPageFrame', () => {
  it('copies the cached frame onto the target canvas', () => {
    const context = fakeContext()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D)
    const target = document.createElement('canvas')
    const source = document.createElement('canvas')
    source.width = 30
    source.height = 40
    const frame: PdfRenderedPageFrame = { key: 'k', pageNumber: 1, scale: 1, canvas: source, width: 15, height: 20, pixelArea: 1200 }

    commitPdfRenderedPageFrame(target, frame)

    expect(target.width).toBe(30)
    expect(target.height).toBe(40)
    expect(target.style.width).toBe('15px')
    expect(target.style.height).toBe('20px')
    expect(context.setTransform).toHaveBeenCalledWith(1, 0, 0, 1, 0, 0)
    expect(context.clearRect).toHaveBeenCalledWith(0, 0, 30, 40)
    expect(context.drawImage).toHaveBeenCalledWith(source, 0, 0)
  })

  it('throws when the target canvas has no 2d context', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const target = document.createElement('canvas')
    const frame: PdfRenderedPageFrame = {
      key: 'k',
      pageNumber: 1,
      scale: 1,
      canvas: document.createElement('canvas'),
      width: 1,
      height: 1,
      pixelArea: 1,
    }

    expect(() => commitPdfRenderedPageFrame(target, frame)).toThrow('无法提交 PDF 缓存帧')
  })
})
