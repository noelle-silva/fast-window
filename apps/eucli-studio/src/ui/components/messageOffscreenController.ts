import {
  MESSAGE_OFFSCREEN_DEFAULT_VIEWPORT_WIDTH,
  MESSAGE_OFFSCREEN_OVERSCAN_VIEWPORTS,
  estimateMessageHeight,
  messageHeightMemory,
  messageLayoutKey,
} from '../../domain/messageOffscreen'

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

function scrollContentTop(el: HTMLElement): number {
  const rect = el.getBoundingClientRect()
  const style = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null
  const paddingTop = style ? Number.parseFloat(style.paddingTop) || 0 : 0
  return rect.top + el.clientTop + paddingTop
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
    if (entry.rendered) this.applyRendered(entry)
    else this.applyHidden(entry)
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
      this.applyRendered(entry)
      return
    }
    if (!meta.pinned && previous.pinned) {
      if (entry.intersecting) this.applyRendered(entry)
      else this.applyHidden(entry)
      return
    }
    if (contentChanged) {
      // 内容变化：可见消息立即重测并换内容键；隐藏消息退回预估占位。
      if (entry.rendered) this.applyRendered(entry)
      else this.applyHidden(entry)
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
    this.applyRendered(target)

    const rootRect = this.scrollEl.getBoundingClientRect()
    const viewportHeight = this.scrollEl.clientHeight || rootRect.height || 0
    const overscan = Math.max(0, viewportHeight) * MESSAGE_OFFSCREEN_OVERSCAN_VIEWPORTS
    const targetRect = target.el.getBoundingClientRect()
    const minTop = targetRect.top - overscan
    const maxBottom = targetRect.bottom + overscan

    const candidates: Entry[] = []
    const nodes = Array.from(this.scrollEl.querySelectorAll<HTMLElement>(`[${SLOT_ATTRIBUTE}]`))
    for (const el of nodes) {
      const entry = this.entryByElement.get(el)
      if (!entry || entry === target || entry.forced || entry.meta.pinned) continue
      const rect = el.getBoundingClientRect()
      if (rect.bottom >= minTop && rect.top <= maxBottom) candidates.push(entry)
    }
    for (const entry of this.orderByDocument(candidates)) {
      entry.forced = true
      this.applyRendered(entry)
    }
    return true
  }

  dispose(): void {
    this.enabled = false
    this.clearForced()
    this.disconnectObservers()
  }

  private applyRendered(entry: Entry): void {
    if (!entry.el.isConnected) return
    // 用变化前的矩形判定是否在视口上方：即使实际高度长入视口，也要按完整高度差补偿。
    const wasAbove = this.isAboveContentTop(entry.el)
    const oldHeight = entry.rendered ? blockHeight(entry.el) || entry.measuredHeight : entry.placeholderHeight
    entry.rendered = true
    entry.el.style.setProperty('content-visibility', 'visible')
    entry.el.style.removeProperty('contain-intrinsic-size')
    entry.el.setAttribute(OFFSCREEN_ATTRIBUTE, 'visible')
    const height = blockHeight(entry.el)
    if (height > 0) this.remember(entry, height)
    if (oldHeight > 0 && height > 0) this.shiftScroll(wasAbove, height - oldHeight)
  }

  private applyHidden(entry: Entry): void {
    const height = this.placeholderHeight(entry)
    if (!entry.rendered && entry.placeholderHeight === height) return
    // 同样使用变化前的矩形：占位变长并跨过视口顶边时仍要补偿。
    const wasAbove = this.isAboveContentTop(entry.el)
    const oldHeight = entry.rendered ? blockHeight(entry.el) || entry.measuredHeight : entry.placeholderHeight
    entry.rendered = false
    entry.placeholderHeight = height
    entry.el.style.setProperty('content-visibility', 'hidden')
    entry.el.style.setProperty('contain-intrinsic-size', `${height}px`)
    entry.el.setAttribute(OFFSCREEN_ATTRIBUTE, 'hidden')
    if (oldHeight > 0) this.shiftScroll(wasAbove, height - oldHeight)
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

  private isAboveContentTop(el: HTMLElement): boolean {
    const scrollEl = this.scrollEl
    if (!scrollEl) return false
    return el.getBoundingClientRect().bottom <= scrollContentTop(scrollEl) + ABOVE_VIEWPORT_EPSILON
  }

  private shiftScroll(wasAbove: boolean, delta: number): void {
    const el = this.scrollEl
    if (!el || !wasAbove || !delta) return
    el.scrollTop = Math.max(0, el.scrollTop + delta)
  }

  private handleIntersections(records: IntersectionObserverEntry[]): void {
    if (!this.enabled) return
    const changes: Array<{ entry: Entry; rendered: boolean }> = []
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
    for (const record of records) {
      if (record.target === this.scrollEl) continue
      const entry = this.entryByElement.get(record.target as HTMLElement)
      if (!entry || !entry.rendered) continue
      const height = blockHeight(entry.el)
      if (height > 0) this.remember(entry, height)
    }
  }

  private applyVisibilityChanges(changes: Array<{ entry: Entry; rendered: boolean }>): void {
    if (!changes.length) return
    const wasAtBottom = this.isAtBottom()
    for (const change of this.orderChanges(changes)) {
      if (!this.entries.has(change.entry.mid)) continue
      if (change.rendered) this.applyRendered(change.entry)
      else this.applyHidden(change.entry)
    }
    // 打开会话时位于底部：恢复附近排版后继续保持底部，避免首批实际高度撑开后退回中部。
    if (wasAtBottom) this.scrollToBottom()
  }

  private reconcileLayout(): void {
    if (!this.enabled) return
    const changes: Array<{ entry: Entry; rendered: boolean }> = []
    for (const entry of this.entries.values()) {
      if (entry.meta.pinned) {
        if (!entry.rendered) changes.push({ entry, rendered: true })
        else {
          const height = blockHeight(entry.el)
          if (height > 0) this.remember(entry, height)
        }
        continue
      }
      if (entry.rendered) {
        const height = blockHeight(entry.el)
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

  private isAtBottom(): boolean {
    const el = this.scrollEl
    if (!el) return false
    return el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_EPSILON
  }

  private scrollToBottom(): void {
    const el = this.scrollEl
    if (!el) return
    el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight)
  }

  private orderChanges(changes: Array<{ entry: Entry; rendered: boolean }>) {
    return changes.slice().sort((a, b) => this.compareEntries(a.entry, b.entry))
  }

  private orderByDocument(entries: Entry[]): Entry[] {
    return entries.slice().sort((a, b) => this.compareEntries(a, b))
  }

  private compareEntries(a: Entry, b: Entry): number {
    if (a.el === b.el) return 0
    const position = a.el.compareDocumentPosition(b.el)
    if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1
    if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1
    return 0
  }
}
