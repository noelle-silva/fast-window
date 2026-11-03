// 一轮同步处理的几何读取器：同一容器 / 同一元素在一轮内只读一次。
// 调用方先集中读取，再集中写入，避免逐条「读位置 → 改样式 → 再读位置」反复触发布局。
export type ElementGeometry = {
  top: number
  bottom: number
  height: number
}

export type ScrollMetrics = {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
  atBottom: boolean
}

export class GeometryReader {
  private readonly rects = new Map<HTMLElement, ElementGeometry>()
  private metrics: ScrollMetrics | null = null
  private contentTopValue: number | null = null

  constructor(private readonly scrollEl: HTMLElement | null) {}

  scrollMetrics(bottomEpsilon: number): ScrollMetrics {
    if (this.metrics) return this.metrics
    const el = this.scrollEl
    if (!el) {
      this.metrics = { scrollTop: 0, scrollHeight: 0, clientHeight: 0, atBottom: false }
      return this.metrics
    }
    const scrollTop = el.scrollTop
    const scrollHeight = el.scrollHeight
    const clientHeight = el.clientHeight
    this.metrics = {
      scrollTop,
      scrollHeight,
      clientHeight,
      atBottom: scrollHeight - scrollTop - clientHeight <= bottomEpsilon,
    }
    return this.metrics
  }

  contentTop(): number {
    if (this.contentTopValue !== null) return this.contentTopValue
    const el = this.scrollEl
    if (!el) {
      this.contentTopValue = 0
      return this.contentTopValue
    }
    const rect = el.getBoundingClientRect()
    const style = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null
    const paddingTop = style ? Number.parseFloat(style.paddingTop) || 0 : 0
    this.contentTopValue = rect.top + el.clientTop + paddingTop
    return this.contentTopValue
  }

  rect(el: HTMLElement): ElementGeometry {
    const cached = this.rects.get(el)
    if (cached) return cached
    const rect = el.getBoundingClientRect()
    const height = isFinite(rect.height) && rect.height > 0 ? rect.height : 0
    const snapshot = { top: rect.top, bottom: rect.bottom, height }
    this.rects.set(el, snapshot)
    return snapshot
  }

  isAboveContentTop(el: HTMLElement, epsilon: number): boolean {
    return this.rect(el).bottom <= this.contentTop() + epsilon
  }
}
