// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import * as React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { MermaidDialog } from './MermaidDialog'
import type { MarkdownPreviewController } from './useMarkdownPreview'

/**
 * 行为锁定测试（084 · 拆分期护栏）：
 * MermaidDialog 的纯逻辑函数（clampNum、parseSvgSize、适配缩放计算）均为模块私有，
 * 唯一导出是展示组件。按 design-7「不为通过而改被测实现」，这里不改业务导出，
 * 改为从组件的 props → DOM 产物确定化地观测这些纯逻辑的行为投影。
 *
 * 不测（展示交互部分，见 design-7 第 5 条）：
 * - 鼠标拖拽、滚轮缩放、点击空白关闭
 * - 复制图片（需 canvas 光栅化 + 剪贴板，且 getMermaidCopyBitmapSize/normalizeSvgForExport
 *   仅在该路径内触达，无法从 DOM 观测）
 * - 上一张/下一张/关闭按钮的交互
 */

beforeAll(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia
  }
})

function makeController(): MarkdownPreviewController {
  return {
    toast: () => {},
    actions: {
      closeModal: () => {},
      openImageViewer: () => {},
      openMermaidViewer: () => {},
      imagePrev: () => {},
      imageNext: () => {},
      imageSetScale: () => {},
      mermaidPrev: () => {},
      mermaidNext: () => {},
      mermaidSetScale: () => {},
    },
  }
}

const originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
const originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')

function mockStageSize(w: number, h: number) {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => w })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => h })
}

function restoreStageSize() {
  if (originalClientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalClientWidth)
  else delete (HTMLElement.prototype as any).clientWidth
  if (originalClientHeight) Object.defineProperty(HTMLElement.prototype, 'clientHeight', originalClientHeight)
  else delete (HTMLElement.prototype as any).clientHeight
}

let activeRoot: Root | null = null

afterEach(() => {
  if (activeRoot) {
    act(() => activeRoot!.unmount())
    activeRoot = null
  }
  document.body.innerHTML = ''
  restoreStageSize()
})

function readScale(): number | null {
  for (const el of Array.from(document.querySelectorAll('div'))) {
    const t = window.getComputedStyle(el).transform
    const m = /^scale\(([-\d.]+)\)$/.exec(t)
    if (m) return Number(m[1])
  }
  return null
}

function readTranslate(): { x: number; y: number } | null {
  for (const el of Array.from(document.querySelectorAll('div'))) {
    const t = window.getComputedStyle(el).transform
    const m = /^translate\(([-\d.]+)px,\s*([-\d.]+)px\)$/.exec(t)
    if (m) return { x: Number(m[1]), y: Number(m[2]) }
  }
  return null
}

function readChipLabel(): string | null {
  return document.querySelector('.MuiChip-label')?.textContent ?? null
}

async function renderDialog(
  mermaid: { items?: unknown; index?: unknown; scale?: unknown },
  stage: { w: number; h: number } = { w: 1000, h: 800 },
): Promise<void> {
  mockStageSize(stage.w, stage.h)
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  activeRoot = root
  await act(async () => {
    root.render(React.createElement(MermaidDialog, { open: true, controller: makeController(), mermaid }))
  })
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 40))
  })
}

const SVG_100x50 = '<svg viewBox="0 0 100 50"><rect/></svg>'
const SVG_1000x500 = '<svg viewBox="0 0 1000 500"><rect/></svg>'

describe('MermaidDialog index normalization', () => {
  it.each([
    [{ items: [{ svg: 'a' }, { svg: 'b' }], index: 5 }, '2/2'],
    [{ items: [{ svg: 'a' }, { svg: 'b' }, { svg: 'c' }], index: -3 }, '1/3'],
    [{ items: [{ svg: 'a' }, { svg: 'b' }, { svg: 'c' }], index: 1 }, '2/3'],
    [{ items: [], index: 0 }, '0/0'],
    [{ items: undefined, index: 0 }, '0/0'],
    [{ items: null, index: 3 }, '0/0'],
  ] as const)('normalizes %o into chip label %s', async (mermaid, expected) => {
    await renderDialog(mermaid as any)
    expect(readChipLabel()).toBe(expected)
  })
})

describe('MermaidDialog zoom normalization', () => {
  it.each([
    [1, 1],
    [0.05, 0.2],
    [99, 10],
    [2.5, 2.5],
    [-4, 0.2],
    [0, 1],
    [undefined, 1],
    [null, 1],
    ['', 1],
    ['2', 2],
    ['0.5', 0.5],
    ['x', 0.2],
    [NaN, 1],
  ])('clamps viewer scale %o to %s', async (scale, expected) => {
    await renderDialog({ items: [{ svg: SVG_100x50 }], index: 0, scale })
    expect(readScale()).toBeCloseTo(expected, 10)
  })
})

describe('MermaidDialog svg size parsing and fit', () => {
  it('fits a small diagram without scaling up and centers it', async () => {
    await renderDialog({ items: [{ svg: SVG_100x50 }], index: 0, scale: 1 }, { w: 1000, h: 800 })
    expect(readScale()).toBeCloseTo(1, 10)
    expect(readTranslate()).toEqual({ x: 450, y: 375 })
  })

  it('shrinks a large diagram to fit the stage', async () => {
    await renderDialog({ items: [{ svg: SVG_1000x500 }], index: 0, scale: 1 }, { w: 100, h: 100 })
    expect(readScale()).toBeCloseTo(0.09200000000000001, 10)
    expect(readTranslate()).toEqual({ x: 3, y: 26 })
  })

  it('multiplies the fit scale by the viewer zoom', async () => {
    await renderDialog({ items: [{ svg: SVG_1000x500 }], index: 0, scale: 2 }, { w: 100, h: 100 })
    expect(readScale()).toBeCloseTo(0.18400000000000002, 10)
    expect(readTranslate()).toEqual({ x: -43, y: 3 })
  })

  it('reads width/height attributes when no viewBox is present', async () => {
    await renderDialog({ items: [{ svg: '<svg width="1000" height="500"><rect/></svg>' }], index: 0, scale: 1 }, { w: 100, h: 100 })
    expect(readScale()).toBeCloseTo(0.09200000000000001, 10)
    expect(readTranslate()).toEqual({ x: 3, y: 26 })
  })

  it.each([
    ['<svg width="100%" height="50%"><rect/></svg>'],
    ['<svg width="abc" height="xyz"><rect/></svg>'],
    ['not-svg'],
  ])('falls back to unit scale for unparseable size %s', async svg => {
    await renderDialog({ items: [{ svg }], index: 0, scale: 1 }, { w: 100, h: 100 })
    expect(readScale()).toBeCloseTo(1, 10)
    expect(readTranslate()).toEqual({ x: 0, y: 0 })
  })

  it('falls back to unit scale when the stage has no size', async () => {
    await renderDialog({ items: [{ svg: SVG_1000x500 }], index: 0, scale: 1 }, { w: 0, h: 0 })
    expect(readScale()).toBeCloseTo(1, 10)
    expect(readTranslate()).toEqual({ x: 0, y: 0 })
  })

  it('renders no transformed content when svg is empty', async () => {
    await renderDialog({ items: [{ svg: '' }], index: 0, scale: 1 }, { w: 100, h: 100 })
    expect(readScale()).toBeNull()
    expect(readTranslate()).toBeNull()
  })
})
