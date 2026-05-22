import { dominantAssetReaderWheelDelta, isInteractiveAssetReaderWheelTarget, normalizeAssetReaderWheelDelta } from './assetReaderWheelInput'

type AssetReaderCtrlWheelZoomOptions = {
  surface: HTMLElement
  getScale: () => number
  setScale: (scale: number) => void
  step: number
  clampScale: (scale: number) => number
}

export type AssetReaderCtrlWheelZoomHandle = {
  destroy: () => void
}

function restoreScrollAnchor(surface: HTMLElement, event: WheelEvent, scaleRatio: number): void {
  const rect = surface.getBoundingClientRect()
  const pointerOffsetX = event.clientX - rect.left
  const pointerOffsetY = event.clientY - rect.top
  const anchorX = surface.scrollLeft + pointerOffsetX
  const anchorY = surface.scrollTop + pointerOffsetY

  window.requestAnimationFrame(() => {
    surface.scrollLeft = anchorX * scaleRatio - pointerOffsetX
    surface.scrollTop = anchorY * scaleRatio - pointerOffsetY
  })
}

export function attachAssetReaderCtrlWheelZoom({
  surface,
  getScale,
  setScale,
  step,
  clampScale,
}: AssetReaderCtrlWheelZoomOptions): AssetReaderCtrlWheelZoomHandle {
  const onWheel = (event: WheelEvent) => {
    if (!(event.ctrlKey || event.metaKey) || isInteractiveAssetReaderWheelTarget(event.target)) return

    const rawDelta = dominantAssetReaderWheelDelta(event)
    const delta = normalizeAssetReaderWheelDelta(event, rawDelta, surface)
    if (!delta) return

    event.preventDefault()
    event.stopPropagation()

    const currentScale = getScale()
    const nextScale = clampScale(currentScale + (delta < 0 ? step : -step))
    if (nextScale === currentScale) return

    setScale(nextScale)
    restoreScrollAnchor(surface, event, nextScale / currentScale)
  }

  surface.addEventListener('wheel', onWheel, { passive: false })

  return {
    destroy: () => surface.removeEventListener('wheel', onWheel),
  }
}
