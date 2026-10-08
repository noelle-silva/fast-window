// @vitest-environment jsdom
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { HyperCortexGateway } from '../gateway'
import type { NoteMeta } from '../core'
import { DEFAULT_GRAPH_SETTINGS } from '../graphSettings'
import { NoteLocalRelationGraphDialog } from './NoteLocalRelationGraphDialog'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function createContextStub() {
  return {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    stroke: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    fillText: vi.fn(),
    lineWidth: 0,
    strokeStyle: '',
    fillStyle: '',
    globalAlpha: 1,
    font: '',
    textBaseline: '',
  }
}

let contextStub: ReturnType<typeof createContextStub>

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverMock
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 600 })
  HTMLCanvasElement.prototype.getContext = (() => contextStub) as unknown as HTMLCanvasElement['getContext']
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

function note(id: string, title = id): NoteMeta {
  return { id, title, description: '', dir: `dir/${id}`, createdAtMs: 0, updatedAtMs: 0 }
}

function createGateway(queryRelations: ReturnType<typeof vi.fn>): HyperCortexGateway {
  return { refs: { queryRelations } } as unknown as HyperCortexGateway
}

let activeRoot: Root | null = null

beforeEach(() => {
  contextStub = createContextStub()
})

afterEach(() => {
  if (activeRoot) {
    act(() => activeRoot!.unmount())
    activeRoot = null
  }
  document.body.innerHTML = ''
})

async function renderDialog(gateway: HyperCortexGateway): Promise<void> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  activeRoot = createRoot(container)
  await act(async () => {
    activeRoot!.render(
      React.createElement(NoteLocalRelationGraphDialog, {
        open: true,
        gateway,
        scope: 'library',
        noteId: 'n1',
        allNotesById: { n1: note('n1') },
        settings: DEFAULT_GRAPH_SETTINGS,
        refRelationsEpoch: 0,
        onClose: () => {},
        onOpenNote: () => {},
      }),
    )
  })
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

function radiusText(): string {
  const match = document.body.textContent?.match(/查看半径\s*(\d+)/)
  return match ? match[1] : ''
}

async function clickButton(label: string): Promise<void> {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(node => node.getAttribute('aria-label') === label)
  if (!button) throw new Error(`未找到按钮：${label}`)
  await act(async () => {
    button.click()
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

function buttonDisabled(label: string): boolean {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(node => node.getAttribute('aria-label') === label)
  return !!button?.disabled
}

describe('NoteLocalRelationGraphDialog', () => {
  it('默认查看半径为 1，并按半径向关注笔记查询子图', async () => {
    const queryRelations = vi.fn(async () => ({ nodes: [{ noteId: 'n1', distance: 0 }], edges: [] }))
    await renderDialog(createGateway(queryRelations))

    expect(radiusText()).toBe('1')
    expect(queryRelations).toHaveBeenCalledWith('library', 'n1', 1, 'both')
  })

  it('右键增大半径、左键减小半径，且半径最小为 1', async () => {
    const queryRelations = vi.fn(async () => ({ nodes: [{ noteId: 'n1', distance: 0 }], edges: [] }))
    await renderDialog(createGateway(queryRelations))

    // 最小半径为 1：左键不可用。
    expect(buttonDisabled('减小查看半径')).toBe(true)

    await clickButton('增大查看半径')
    expect(radiusText()).toBe('2')
    expect(queryRelations).toHaveBeenLastCalledWith('library', 'n1', 2, 'both')

    await clickButton('减小查看半径')
    expect(radiusText()).toBe('1')
    expect(queryRelations).toHaveBeenLastCalledWith('library', 'n1', 1, 'both')
    expect(buttonDisabled('减小查看半径')).toBe(true)
  })

  it('切换查看半径不重建画布：画布元素保持同一个', async () => {
    const queryRelations = vi.fn(async () => ({ nodes: [{ noteId: 'n1', distance: 0 }], edges: [] }))
    await renderDialog(createGateway(queryRelations))

    const canvasBefore = document.querySelector('canvas')
    expect(canvasBefore).not.toBeNull()

    await clickButton('增大查看半径')

    // 半径变化前后是同一个 canvas 元素：画布没有被卸载重挂，视角与节点位置才能保留。
    expect(document.querySelector('canvas')).toBe(canvasBefore)
  })
})
