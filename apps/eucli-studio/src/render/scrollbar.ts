import {
  CUSTOM_SCROLL_THUMB_ATTR,
  computeThumbDragScroll,
  measureCustomScrollArea,
  thumbTravelSize,
} from '../core/scrollMetrics'

// ============================================================================
// 渲染管道用的横向滑块。
//
// Markdown 表格由渲染管道直接生成裸 DOM，挂不上 React 的滚动条组件，
// 于是这里提供同一套行为的 DOM 版本：度量、拖拽换算、粗细与边距全部取自
// core/scrollMetrics，与 React 侧（useCustomScrollbar）一致。
//
// 生命周期跟随宿主节点：不登记任何全局表，滑块与监听只挂在容器自身，
// 流式重渲染丢弃旧容器后整条引用链可被回收，不会累积。
// ============================================================================

const THUMB_CLASS = 'fw-dom-scroll-thumb'
// 宿主上的「可横向滚动」标记：CSS 据此给滚动层留出滑块空间。
const SCROLLABLE_ATTR = 'data-fw-scrollable'
const DRAGGING_ATTR = 'data-dragging'
const VISIBLE_ATTR = 'data-visible'

export type DomScrollbarHandle = {
  refresh: () => void
  destroy: () => void
}

export function mountHorizontalScrollbar(options: {
  hostEl: HTMLElement
  scrollEl: HTMLElement
}): DomScrollbarHandle {
  const { hostEl, scrollEl } = options

  const thumb = document.createElement('div')
  thumb.className = THUMB_CLASS
  thumb.setAttribute(CUSTOM_SCROLL_THUMB_ATTR, '1')
  thumb.setAttribute('role', 'scrollbar')
  thumb.setAttribute('aria-orientation', 'horizontal')
  hostEl.appendChild(thumb)

  let frame = 0
  let handle: DomScrollbarHandle

  const update = () => {
    const metrics = measureCustomScrollArea(scrollEl, { allowX: true })
    hostEl.toggleAttribute(SCROLLABLE_ATTR, metrics.canX)
    thumb.toggleAttribute(VISIBLE_ATTR, metrics.canX)
    thumb.setAttribute('aria-hidden', metrics.canX ? 'false' : 'true')
    if (!metrics.canX) return
    thumb.style.width = `${Math.round(metrics.xWidth)}px`
    thumb.style.left = `${Math.round(metrics.xLeft)}px`
  }

  // 合并同一帧内的多次触发：滚动与尺寸变化可能同时发生。
  const refresh = () => {
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      // 宿主已离开文档说明这一帧是旧容器的迟到回调，直接收尾。
      if (!scrollEl.isConnected) {
        handle.destroy()
        return
      }
      update()
    })
  }

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return
    const maxScroll = scrollEl.scrollWidth - scrollEl.clientWidth
    if (maxScroll <= 0) return

    event.preventDefault()
    event.stopPropagation()

    const startPointer = event.clientX
    const startScroll = scrollEl.scrollLeft
    const maxThumbTravel = thumbTravelSize({
      viewportSize: scrollEl.clientWidth,
      thumbSize: thumb.offsetWidth,
    })

    thumb.setAttribute(DRAGGING_ATTR, '1')
    thumb.setPointerCapture(event.pointerId)

    const onMove = (move: PointerEvent) => {
      if (move.pointerId !== event.pointerId) return
      scrollEl.scrollLeft = computeThumbDragScroll({
        startScroll,
        pointerDelta: move.clientX - startPointer,
        maxScroll,
        maxThumbTravel,
      })
      refresh()
    }

    const finish = (up: PointerEvent) => {
      if (up.pointerId !== event.pointerId) return
      thumb.removeAttribute(DRAGGING_ATTR)
      thumb.removeEventListener('pointermove', onMove)
      thumb.removeEventListener('pointerup', finish)
      thumb.removeEventListener('pointercancel', finish)
      if (thumb.hasPointerCapture(event.pointerId)) thumb.releasePointerCapture(event.pointerId)
    }

    thumb.addEventListener('pointermove', onMove)
    thumb.addEventListener('pointerup', finish)
    thumb.addEventListener('pointercancel', finish)
  }

  const observer = new ResizeObserver(refresh)
  observer.observe(scrollEl)
  observer.observe(hostEl)
  const content = scrollEl.firstElementChild
  if (content) observer.observe(content)

  handle = {
    refresh,
    destroy() {
      if (frame) cancelAnimationFrame(frame)
      frame = 0
      observer.disconnect()
      scrollEl.removeEventListener('scroll', refresh)
      thumb.removeEventListener('pointerdown', onPointerDown)
      hostEl.removeAttribute(SCROLLABLE_ATTR)
      thumb.remove()
    },
  }

  // 先备好 handle 再接线：回调（滚动 / 尺寸变化）都是异步的，此处不会提前触发。
  scrollEl.addEventListener('scroll', refresh, { passive: true })
  thumb.addEventListener('pointerdown', onPointerDown)
  update()

  return handle
}
