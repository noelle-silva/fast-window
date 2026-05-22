const READER_WHEEL_DELTA_LINE = 1
export const READER_WHEEL_DELTA_PAGE = 2
const READER_WHEEL_LINE_HEIGHT = 40
const INTERACTIVE_WHEEL_TARGET_SELECTOR = 'input, textarea, select, button, [role="button"], [contenteditable="true"], [data-asset-reader-wheel-ignore]'

function closestWheelTarget(target: EventTarget | null): { closest: (selector: string) => Element | null } | null {
  if (!target || typeof (target as { closest?: unknown }).closest !== 'function') return null
  return target as unknown as { closest: (selector: string) => Element | null }
}

export function isInteractiveAssetReaderWheelTarget(target: EventTarget | null): boolean {
  return Boolean(closestWheelTarget(target)?.closest(INTERACTIVE_WHEEL_TARGET_SELECTOR))
}

export function dominantAssetReaderWheelDelta(event: WheelEvent): number {
  return Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
}

export function normalizeAssetReaderWheelDelta(event: WheelEvent, rawDelta: number, surface: HTMLElement): number {
  if (!Number.isFinite(rawDelta) || rawDelta === 0) return 0
  if (event.deltaMode === READER_WHEEL_DELTA_LINE) return rawDelta * READER_WHEEL_LINE_HEIGHT
  if (event.deltaMode === READER_WHEEL_DELTA_PAGE) return rawDelta * Math.max(surface.clientHeight, 1)
  return rawDelta
}
