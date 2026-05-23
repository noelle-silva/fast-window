import { dominantAssetReaderWheelDelta, isInteractiveAssetReaderWheelTarget, normalizeAssetReaderWheelDelta } from './assetReaderWheelInput'
import { captureAssetReaderViewportAnchor, type AssetReaderViewportAnchor } from './assetReaderViewportAnchor'

type AssetReaderCtrlWheelZoomOptions = {
  surface: HTMLElement
  getScale: () => number
  setScale: (scale: number) => void
  onScaleCommitted: (anchor: AssetReaderViewportAnchor) => void
  step: number
  clampScale: (scale: number) => number
}

export type AssetReaderCtrlWheelZoomHandle = {
  destroy: () => void
}

export function attachAssetReaderCtrlWheelZoom({
  surface,
  getScale,
  setScale,
  onScaleCommitted,
  step,
  clampScale,
}: AssetReaderCtrlWheelZoomOptions): AssetReaderCtrlWheelZoomHandle {
  let activeAnchor: AssetReaderViewportAnchor | null = null

  const releaseAnchor = () => {
    activeAnchor = null
  }

  const onKeyUp = (event: KeyboardEvent) => {
    if (event.key === 'Control' || event.key === 'Meta') releaseAnchor()
  }

  const onWheel = (event: WheelEvent) => {
    if (!(event.ctrlKey || event.metaKey) || isInteractiveAssetReaderWheelTarget(event.target)) return

    const rawDelta = dominantAssetReaderWheelDelta(event)
    const delta = normalizeAssetReaderWheelDelta(event, rawDelta, surface)
    if (!delta) return

    event.preventDefault()
    event.stopPropagation()

    const currentScale = getScale()
    if (!Number.isFinite(currentScale) || currentScale <= 0) return
    const nextScale = clampScale(currentScale + (delta < 0 ? step : -step))
    if (nextScale === currentScale) return

    activeAnchor = activeAnchor ?? captureAssetReaderViewportAnchor(surface)
    if (!activeAnchor) return
    setScale(nextScale)
    onScaleCommitted(activeAnchor)
  }

  surface.addEventListener('wheel', onWheel, { passive: false })
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', releaseAnchor)

  return {
    destroy: () => {
      surface.removeEventListener('wheel', onWheel)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', releaseAnchor)
    },
  }
}
