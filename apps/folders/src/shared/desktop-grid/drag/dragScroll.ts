const WHEEL_DELTA_LINE = 1
const WHEEL_DELTA_PAGE = 2

export type DragWheelTarget<TItem> = { item: TItem; clientX: number; clientY: number }
type MutableRef<TValue> = { current: TValue }

export function findScrollableParent(el: HTMLElement): HTMLElement | null {
  let current = el.parentElement
  while (current) {
    const style = window.getComputedStyle(current)
    if (/(auto|scroll)/.test(style.overflowY)) return current
    current = current.parentElement
  }
  return null
}

export function scrollDuringDragWheel(containerNode: HTMLElement, event: WheelEvent): boolean {
  const scrollEl = findScrollableParent(containerNode)
  if (!scrollEl) return false

  const previousTop = scrollEl.scrollTop
  scrollEl.scrollTop += wheelDeltaY(event, scrollEl.clientHeight)
  return scrollEl.scrollTop !== previousTop
}

export function setDragWheelTarget<TItem>(targetRef: MutableRef<DragWheelTarget<TItem> | null>, item: TItem, clientX: number, clientY: number): void {
  targetRef.current = { item, clientX, clientY }
}

export function clearDragWheelTarget<TItem>(targetRef: MutableRef<DragWheelTarget<TItem> | null>): void {
  targetRef.current = null
}

export function projectDragWheel<TItem>(containerNode: HTMLElement, target: DragWheelTarget<TItem> | null, event: WheelEvent, project: (item: TItem, clientX: number, clientY: number, event: WheelEvent) => void): boolean {
  if (!target || !scrollDuringDragWheel(containerNode, event)) return false

  event.preventDefault()
  project(target.item, target.clientX, target.clientY, event)
  return true
}

function wheelDeltaY(event: WheelEvent, pageHeight: number): number {
  if (event.deltaMode === WHEEL_DELTA_LINE) return event.deltaY * 16
  if (event.deltaMode === WHEEL_DELTA_PAGE) return event.deltaY * pageHeight
  return event.deltaY
}
