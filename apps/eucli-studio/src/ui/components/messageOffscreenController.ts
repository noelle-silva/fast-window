import {
  MESSAGE_OFFSCREEN_DEFAULT_VIEWPORT_WIDTH,
  MESSAGE_OFFSCREEN_OVERSCAN_VIEWPORTS,
  estimateMessageHeight,
  messageHeightMemory,
  messageLayoutKey,
} from '../../domain/messageOffscreen'
import { GeometryReader, type ScrollMetrics } from './messageOffscreenGeometry'

export type MessageOffscreenSlotMeta = {
  pinned: boolean
  contentKey: string
  message: any
}

type Entry = {
  mid: string
  el: HTMLElement
  meta: MessageOffscreenSlotMeta
  intersecting: boolean
  forced: boolean
  rendered: boolean
  placeholderHeight: number
  measuredHeight: number
}

type VisibilityChange = {
  entry: Entry
  rendered: boolean
}

// 一轮判定的完整计划：所有几何值在写入前一次读齐，写入阶段只消费这些快照。
type TransitionPlan = {
  entry: Entry
  rendered: boolean
  wasRendered: boolean
  wasAbove: boolean
  rawHeight: number
  oldHeight: number
  nextHeight: number
}

const SLOT_ATTRIBUTE = 'data-fw-message-slot'
const OFFSCREEN_ATTRIBUTE = 'data-fw-message-offscreen'
const OFFSCREEN_ROOT_MARGIN = `${MESSAGE_OFFSCREEN_OVERSCAN_VIEWPORTS * 100}% 0px`
const ABOVE_VIEWPORT_EPSILON = 0.5
const BOTTOM_EPSILON = 2

function blockHeight(el: HTMLElement): number {
  const height = el.getBoundingClientRect().height
  return isFinite(height) && height > 0 ? height : 0
}

function normalizedHeight(value: number): number {
  return Math.max(1, Math.round(value * 100) / 100)
}

// 屏外跳过控制器：直接管理消息外层节点的 content-visibility / contain-intrinsic-size。
// 只有激活页会收到观察与测量；隐藏的保活页保留最后一次样式，不参与任何计算。
export class MessageOffscreenController {
  private scrollEl: HTMLElement | null = null
  private layoutSignature: string
  private layoutKey: string
  private viewportWidth = MESSAGE_OFFSCREEN_DEFAULT_VIEWPORT_WIDTH
  private enabled = false
  private entries = new Map<string, Entry>()
  private entryByElement = new WeakMap<HTMLElement, Entry>()
  private intersectionObserver: IntersectionObserver | null = null
  private resizeObserver: ResizeObserver | null = null

  constructor(layoutSignature = '') {
    this.layoutSignature = String(layoutSignature || '')
    this.layoutKey = messageLayoutKey(this.layoutSignature, this.viewportWidth)
  }

  setScrollElement(el: HTMLElement | null): void {
    if (this.scrollEl === el) return
    this.disconnectObservers()
    this.scrollEl = el
    if (!el) return
    this.updateViewportWidth()
    if (!this.enabled) return
    this.reconcileLayout()
    this.observeAll()
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return
    this.enabled = enabled
    if (!enabled) {
      this.clearForced()
      this.disconnectObservers()
      return
    }
    this.clearForced()
    this.updateViewportWidth()
    this.reconcileLayout()
    this.observeAll()
  }

  setLayoutSignature(layoutSignature: string): void {
    const next = String(layoutSignature || '')
    if (next === this.layoutSignature) return
    this.layoutSignature = next
    this.layoutKey = messageLayoutKey(this.layoutSignature, this.viewportWidth)
    if (this.enabled) this.reconcileLayout()
  }

  attach(mid0: string, el: HTMLElement, meta: MessageOffscreenSlotMeta): void {
    const mid = String(mid0 || '').trim()
    if (!mid || !el) return
    const current = this.entries.get(mid)
    if (current && current.el !== el) this.detach(mid, current.el)
    const entry: Entry = {
      mid,
      el,
      meta,
      intersecting: !!meta.pinned,
      forced: false,
      rendered: !!meta.pinned,
      placeholderHeight: 0,
      measuredHeight: 0,
    }
    this.entries.set(mid, entry)
    this.entryByElement.set(el, entry)
    if (this.enabled) {
      this.ensureObservers()
      this.intersectionObserver?.observe(el)
      this.resizeObserver?.observe(el)
    }
    // 新条目的旧高度恒为 0，不可能需要滚动补偿：首次挂载只写样式，不做任何布局读取。
    if (entry.rendered) this.renderFreshEntry(entry)
    else this.writeHidden(entry, this.placeholderHeight(entry))
  }

  update(mid0: string, meta: MessageOffscreenSlotMeta): void {
    const mid = String(mid0 || '').trim()
    const entry = this.entries.get(mid)
    if (!entry) return
    const previous = entry.meta
    const contentChanged = meta.contentKey !== previous.contentKey
    const pinChanged = !!meta.pinned !== !!previous.pinned
    entry.meta = meta
    if (!this.enabled) return
    if (!contentChanged && !pinChanged && !entry.rendered) return

    if (meta.pinned && !previous.pinned) {
      entry.intersecting = true
      this.applyVisibilityChanges([{ entry, rendered: true }])
      return
    }
    if (!meta.pinned && previous.pinned) {
      this.applyVisibilityChanges([{ entry, rendered: entry.intersecting }])
      return
    }
    if (contentChanged) {
      // 可见消息的内容变化已由 React 提交到 DOM，只需读取一次当前高度更新记忆。
      if (entry.rendered) {
        if (!entry.el.isConnected) return
        const height = blockHeight(entry.el)
        if (height > 0) this.remember(entry, height)
      } else {
        this.applyVisibilityChanges([{ entry, rendered: false }])
      }
    }
  }

  detach(mid0: string, el: HTMLElement): void {
    const mid = String(mid0 || '').trim()
    const entry = this.entries.get(mid)
    if (!entry || entry.el !== el) return
    this.entries.delete(mid)
    this.entryByElement.delete(el)
    this.intersectionObserver?.unobserve(el)
    this.resizeObserver?.unobserve(el)
  }

  // 跳转前先恢复目标及上下各一屏的排版，随后调用方再读取目标节点完成定位。
  revealAround(mid0: string): boolean {
    if (!this.enabled || !this.scrollEl) return false
    const mid = String(mid0 || '').trim()
    const target = this.entries.get(mid)
    if (!target) return false

    target.forced = true
    this.applyVisibilityChanges([{ entry: target, rendered: true }], { stickToBottom: false })

    const reader = new GeometryReader(this.scrollEl)
    const rootRect = this.scrollEl.getBoundingClientRect()
    const viewportHeight = this.scrollEl.clientHeight || rootRect.height || 0
    const overscan = Math.max(0, viewportHeight) * MESSAGE_OFFSCREEN_OVERSCAN_VIEWPORTS
    const targetRect = reader.rect(target.el)
    const minTop = targetRect.top - overscan
    const maxBottom = targetRect.bottom + overscan

    const changes: VisibilityChange[] = []
    const nodes = Array.from(this.scrollEl.querySelectorAll<HTMLElement>(`[${SLOT_ATTRIBUTE}]`))
    for (const el of nodes) {
      const entry = this.entryByElement.get(el)
      if (!entry || entry === target || entry.forced || entry.meta.pinned) continue
      const rect = reader.rect(el)
      if (rect.bottom >= minTop && rect.top <= maxBottom) {
        entry.forced = true
        changes.push({ entry, rendered: true })
      }
    }
    this.applyVisibilityChanges(changes, { stickToBottom: false })
    return true
  }

  dispose(): void {
    this.enabled = false
    this.clearForced()
    this.disconnectObservers()
  }

  private renderFreshEntry(entry: Entry): void {
    if (!entry.el.isConnected) return
    this.writeRendered(entry)
    const height = blockHeight(entry.el)
    if (height > 0) this.remember(entry, height)
  }

  private applyVisibilityChanges(
    changes: VisibilityChange[],
    options: { stickToBottom: boolean } = { stickToBottom: true },
  ): void {
    if (!changes.length) return
    const reader = new GeometryReader(this.scrollEl)
    // 读取阶段：滚动指标只读一次，各条目几何按需读取并缓存，此阶段结束后才开始写样式。
    const metrics = reader.scrollMetrics(BOTTOM_EPSILON)
    const plans = this.planTransitions(changes, reader)
    if (plans.length) {
      // 写入阶段：只消费读取阶段的快照，不做任何布局读取。
      for (const plan of plans) {
        if (plan.rendered) this.writeRendered(plan.entry)
        else this.writeHidden(plan.entry, plan.nextHeight)
      }
      // 新一轮渲染后的高度只能由浏览器排版得出：统一再采样一次，仍然是批量读取。
      this.measureRenderedHeights(plans)
    }
    this.commitScroll(plans, metrics, options.stickToBottom)
  }

  private planTransitions(changes: VisibilityChange[], reader: GeometryReader): TransitionPlan[] {
    const plans: TransitionPlan[] = []
    for (const change of this.orderChanges(changes)) {
      const entry = change.entry
      if (!this.entries.has(entry.mid)) continue
      if (change.rendered && !entry.el.isConnected) continue
      const wasRendered = entry.rendered
      if (!change.rendered) {
        const nextHeight = this.placeholderHeight(entry)
        if (!wasRendered && entry.placeholderHeight === nextHeight) continue
        const rawHeight = wasRendered ? reader.rect(entry.el).height : 0
        const oldHeight = wasRendered ? rawHeight || entry.measuredHeight : entry.placeholderHeight
        plans.push({
          entry,
          rendered: false,
          wasRendered,
          rawHeight,
          oldHeight,
          nextHeight,
          wasAbove: oldHeight > 0 && nextHeight !== oldHeight && this.isAboveContentTop(entry, reader),
        })
        continue
      }
      const rawHeight = wasRendered ? reader.rect(entry.el).height : 0
      const oldHeight = wasRendered ? rawHeight || entry.measuredHeight : entry.placeholderHeight
      plans.push({
        entry,
        rendered: true,
        wasRendered,
        rawHeight,
        oldHeight,
        nextHeight: oldHeight,
        wasAbove: !wasRendered && oldHeight > 0 && this.isAboveContentTop(entry, reader),
      })
    }
    return plans
  }

  private measureRenderedHeights(plans: TransitionPlan[]): void {
    let reader: GeometryReader | null = null
    for (const plan of plans) {
      if (!plan.rendered) continue
      if (plan.wasRendered) {
        // 已经是完整排版状态：写入不会改变高度，直接用读取阶段的实测值刷新记忆。
        if (plan.rawHeight > 0) this.remember(plan.entry, plan.rawHeight)
        continue
      }
      if (!reader) reader = new GeometryReader(this.scrollEl)
      const height = reader.rect(plan.entry.el).height
      plan.nextHeight = height
      if (height > 0) this.remember(plan.entry, height)
    }
  }

  private isAboveContentTop(entry: Entry, reader: GeometryReader): boolean {
    return !!this.scrollEl && reader.isAboveContentTop(entry.el, ABOVE_VIEWPORT_EPSILON)
  }

  private commitScroll(plans: TransitionPlan[], metrics: ScrollMetrics, stickToBottom: boolean): void {
    const el = this.scrollEl
    if (!el) return
    let totalDelta = 0
    for (const plan of plans) totalDelta += plan.nextHeight - plan.oldHeight
    if (stickToBottom && metrics.atBottom) {
      // 底部吸附以初始滚动高度加上本轮总高度差计算，避免写后再读 scrollHeight。
      el.scrollTop = Math.max(0, metrics.scrollHeight + totalDelta - metrics.clientHeight)
      return
    }
    let scrollTop = metrics.scrollTop
    for (const plan of plans) {
      if (!plan.wasAbove || plan.oldHeight <= 0 || plan.nextHeight <= 0) continue
      const delta = plan.nextHeight - plan.oldHeight
      if (!delta) continue
      scrollTop = Math.max(0, scrollTop + delta)
    }
    if (scrollTop !== metrics.scrollTop) el.scrollTop = scrollTop
  }

  private writeRendered(entry: Entry): void {
    entry.rendered = true
    entry.el.style.setProperty('content-visibility', 'visible')
    entry.el.style.removeProperty('contain-intrinsic-size')
    entry.el.setAttribute(OFFSCREEN_ATTRIBUTE, 'visible')
  }

  private writeHidden(entry: Entry, height: number): void {
    entry.rendered = false
    entry.placeholderHeight = height
    entry.el.style.setProperty('content-visibility', 'hidden')
    entry.el.style.setProperty('contain-intrinsic-size', `${height}px`)
    entry.el.setAttribute(OFFSCREEN_ATTRIBUTE, 'hidden')
  }

  private placeholderHeight(entry: Entry): number {
    const remembered = messageHeightMemory.get(entry.mid, this.layoutKey, entry.meta.contentKey)
    if (remembered && remembered > 0) return normalizedHeight(remembered)
    return normalizedHeight(estimateMessageHeight(entry.meta.message, this.viewportWidth))
  }

  private remember(entry: Entry, height: number): void {
    const next = normalizedHeight(height)
    entry.measuredHeight = next
    messageHeightMemory.set(entry.mid, this.layoutKey, entry.meta.contentKey, next)
  }

  private handleIntersections(records: IntersectionObserverEntry[]): void {
    if (!this.enabled) return
    const changes: VisibilityChange[] = []
    for (const record of records) {
      const entry = this.entryByElement.get(record.target as HTMLElement)
      if (!entry) continue
      const intersecting = !!record.isIntersecting
      entry.intersecting = intersecting
      if (intersecting) entry.forced = false
      if (entry.meta.pinned) {
        // 生成中消息无论在禁用期间发生何种翻转，重新判定时都必须渲染。
        if (!entry.rendered) changes.push({ entry, rendered: true })
        continue
      }
      if (entry.forced) continue
      if (intersecting && !entry.rendered) changes.push({ entry, rendered: true })
      else if (!intersecting && entry.rendered) changes.push({ entry, rendered: false })
    }
    this.applyVisibilityChanges(changes)
  }

  private handleResizes(records: ResizeObserverEntry[]): void {
    if (!this.enabled) return
    let widthChanged = false
    for (const record of records) {
      if (record.target !== this.scrollEl) continue
      const width = this.scrollEl.clientWidth
      if (width > 0 && width !== this.viewportWidth) {
        this.viewportWidth = width
        this.layoutKey = messageLayoutKey(this.layoutSignature, this.viewportWidth)
        widthChanged = true
      }
    }
    if (widthChanged) {
      this.reconcileLayout()
      return
    }
    const reader = new GeometryReader(this.scrollEl)
    for (const record of records) {
      if (record.target === this.scrollEl) continue
      const entry = this.entryByElement.get(record.target as HTMLElement)
      if (!entry || !entry.rendered) continue
      const height = reader.rect(entry.el).height
      if (height > 0) this.remember(entry, height)
    }
  }

  private reconcileLayout(): void {
    if (!this.enabled) return
    const reader = new GeometryReader(this.scrollEl)
    const changes: VisibilityChange[] = []
    for (const entry of this.entries.values()) {
      if (entry.meta.pinned) {
        if (!entry.rendered) changes.push({ entry, rendered: true })
        else {
          const height = reader.rect(entry.el).height
          if (height > 0) this.remember(entry, height)
        }
        continue
      }
      if (entry.rendered) {
        const height = reader.rect(entry.el).height
        if (height > 0) this.remember(entry, height)
      } else {
        changes.push({ entry, rendered: false })
      }
    }
    this.applyVisibilityChanges(changes)
  }

  private updateViewportWidth(): void {
    const el = this.scrollEl
    const width = el && el.clientWidth > 0 ? el.clientWidth : MESSAGE_OFFSCREEN_DEFAULT_VIEWPORT_WIDTH
    this.viewportWidth = width
    this.layoutKey = messageLayoutKey(this.layoutSignature, this.viewportWidth)
  }

  private observeAll(): void {
    this.disconnectObservers()
    if (!this.enabled || !this.scrollEl) return
    this.ensureObservers()
    if (!this.intersectionObserver || !this.resizeObserver) return
    this.resizeObserver.observe(this.scrollEl)
    for (const entry of this.entries.values()) {
      this.intersectionObserver.observe(entry.el)
      this.resizeObserver.observe(entry.el)
    }
  }

  private ensureObservers(): void {
    if (!this.enabled || !this.scrollEl) return
    if (this.intersectionObserver && this.resizeObserver) return
    const scrollEl = this.scrollEl
    this.intersectionObserver = new IntersectionObserver(
      (records) => this.handleIntersections(records),
      { root: scrollEl, rootMargin: OFFSCREEN_ROOT_MARGIN, threshold: 0 },
    )
    this.resizeObserver = new ResizeObserver((records) => this.handleResizes(records))
  }

  private disconnectObservers(): void {
    this.intersectionObserver?.disconnect()
    this.resizeObserver?.disconnect()
    this.intersectionObserver = null
    this.resizeObserver = null
  }

  private clearForced(): void {
    for (const entry of this.entries.values()) entry.forced = false
  }

  private orderChanges(changes: VisibilityChange[]): VisibilityChange[] {
    return changes.slice().sort((a, b) => this.compareEntries(a.entry, b.entry))
  }

  private compareEntries(a: Entry, b: Entry): number {
    if (a.el === b.el) return 0
    const position = a.el.compareDocumentPosition(b.el)
    if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1
    if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1
    return 0
  }
}
