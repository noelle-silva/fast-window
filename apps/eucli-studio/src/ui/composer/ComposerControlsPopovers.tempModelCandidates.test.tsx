// @vitest-environment happy-dom
//
// 临时模型弹层里的「角色候选模型」区块：候选再多也不把弹层一路撑高，
// 区块自己成为限高滚动视口，滚动条走客户端自制滑块（原生条保持隐藏）。
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ComposerControlsPopovers } from './ComposerControlsPopovers'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const CANDIDATE_COUNT = 12

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = []

  constructor(public callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this)
  }

  observe() {}

  unobserve() {}

  disconnect() {}

  emit() {
    this.callback([], this as any)
  }
}

// happy-dom 不做布局：滚动元素的几何自己托管。
function defineScrollGeometry(el: HTMLElement, args: { clientHeight: number; scrollHeight: number }) {
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => args.clientHeight })
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => args.scrollHeight })
  Object.defineProperty(el, 'scrollTop', { configurable: true, get: () => 0, set: () => {} })
}

// sx 编译成 class，样式不在内联 style 上：要核对限高与原生条隐藏，只能回样式表捞声明块。
function declarationsFor(el: Element): string[] {
  const classes = Array.from(el.classList)
  const found: string[] = []
  for (const sheet of Array.from(document.querySelectorAll('style'))) {
    const text = sheet.textContent || ''
    for (const className of classes) {
      const selector = `.${className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`
      const match = new RegExp(`${selector}[^{]*\\{([^}]*)\\}`).exec(text)
      if (match) found.push(match[1])
    }
  }
  return found
}

function hasDeclaration(el: Element, pattern: RegExp) {
  return declarationsFor(el).some((block) => pattern.test(block))
}

function candidateAt(index: number) {
  return { kind: 'provider' as const, providerId: 'provider-1', groupId: '', modelId: `model-${index}` }
}

function popoverProps(anchor: HTMLElement) {
  return {
    controller: {},
    loading: false,
    providers: [{ id: 'provider-1', name: '本地供应商' }],
    modelGroups: [],
    roleSessionControlsEnabled: true,
    tempModelPickerEl: anchor,
    closeTempModelPicker: () => {},
    tempModelSource: 'provider' as const,
    onTempModelSourceChanged: () => {},
    tempModelProviderId: 'provider-1',
    onTempProviderChanged: () => {},
    tempModelGroupId: '',
    onTempModelGroupChanged: () => {},
    tempModelPick: '',
    setTempModelPick: () => {},
    tempModelReady: true,
    roleModelCandidates: Array.from({ length: CANDIDATE_COUNT }, (_, index) => candidateAt(index + 1)),
    tempModelHighlightKey: '',
    onPickRoleModelCandidate: () => {},
    clearTempModelOverride: () => {},
    hasChatOverride: false,
    saveTempModelOverride: () => {},
    reasoningPickerEl: null,
    closeReasoningPicker: () => {},
    activeEffectiveReasoningEffort: null,
    activeChatReasoningEffort: null,
    pickReasoningEffort: () => {},
    clearReasoningEffort: () => {},
    hasChatReasoningOverride: false,
    asyncToolTasksEl: null,
    closeAsyncToolTasks: () => {},
    refreshAsyncToolTasks: () => {},
    asyncToolTasksLoading: false,
    asyncToolTasks: [],
  }
}

describe('临时模型弹层的角色候选模型区块', () => {
  let host: HTMLDivElement | null = null
  let anchor: HTMLButtonElement | null = null
  let root: any = null
  let frames = new Map<number, FrameRequestCallback>()
  let nextFrameId = 1

  const flushFrames = () => {
    const pending = Array.from(frames.values())
    frames.clear()
    for (const callback of pending) callback(0)
  }

  const mount = () => {
    act(() => root.render(<ComposerControlsPopovers {...popoverProps(anchor!)} />))
    const area = document.querySelector('[data-area="temp-model"]')
    if (!area) throw new Error('临时模型弹层没渲染出来')
    const viewport = area.querySelector('[data-eucli-scroll-viewport]')
    if (!viewport) throw new Error('角色候选模型没有落在滚动视口里')
    return { area, viewport }
  }

  // 让滚动视口按给定几何重新度量：滚动事件是内核真实的度量触发路径之一。
  const settleGeometry = (viewport: Element, args: { clientHeight: number; scrollHeight: number }) => {
    act(() => {
      defineScrollGeometry(viewport as HTMLElement, args)
      viewport.dispatchEvent(new Event('scroll'))
    })
    act(() => flushFrames())
  }

  beforeEach(() => {
    FakeResizeObserver.instances = []
    frames = new Map()
    nextFrameId = 1
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = nextFrameId++
      frames.set(id, callback)
      return id
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      frames.delete(id)
    })
    host = document.createElement('div')
    document.body.appendChild(host)
    anchor = document.createElement('button')
    document.body.appendChild(anchor)
    root = createRoot(host)
  })

  afterEach(() => {
    if (root) {
      act(() => root.unmount())
      root = null
    }
    host?.remove()
    host = null
    anchor?.remove()
    anchor = null
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('候选全部落在限高滚动视口里，原生滚动条保持隐藏', () => {
    const { viewport } = mount()
    expect(viewport.textContent).toContain(`model-${CANDIDATE_COUNT}`)
    expect(hasDeclaration(viewport, /max-height:\s*240px/)).toBe(true)
    expect(hasDeclaration(viewport, /scrollbar-width:\s*none/)).toBe(true)
    // 自制滑块的定位容器同样限高，滑块轨道才不会跟着内容一起拉长。
    expect(hasDeclaration(viewport.parentElement!, /max-height:\s*240px/)).toBe(true)
  })

  it('候选超出限定高度时出现客户端自制滑块', () => {
    const { area, viewport } = mount()
    expect(area.querySelector('[data-eucli-scroll-thumb="1"]')).toBeNull()

    settleGeometry(viewport, { clientHeight: 240, scrollHeight: 528 })

    expect(area.querySelector('[data-eucli-scroll-thumb="1"]')).toBeTruthy()
  })

  it('候选没超高度时不出滑块', () => {
    const { area, viewport } = mount()
    settleGeometry(viewport, { clientHeight: 240, scrollHeight: 220 })
    expect(area.querySelector('[data-eucli-scroll-thumb="1"]')).toBeNull()
  })
})
