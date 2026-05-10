import * as React from 'react'

type TransientDragLayouts<TLayoutMap> = {
  activeLayouts: TLayoutMap
  activeLayoutsRef: React.MutableRefObject<TLayoutMap>
  clearPreviewLayouts(): void
  clearReleaseLayouts(): void
  lockReleaseLayouts(layouts: TLayoutMap): void
  resetTransientLayouts(): void
  setProjectedLayouts(layouts: TLayoutMap | null): void
  setPreviewLayouts(layouts: TLayoutMap): void
}

export function useTransientDragLayouts<TLayoutMap>(baseLayouts: TLayoutMap): TransientDragLayouts<TLayoutMap> {
  const [previewLayouts, setPreviewLayoutsState] = React.useState<TLayoutMap | null>(null)
  const [projectedLayouts, setProjectedLayoutsState] = React.useState<TLayoutMap | null>(null)
  const [releaseLayouts, setReleaseLayoutsState] = React.useState<TLayoutMap | null>(null)
  const activeLayoutsRef = React.useRef(baseLayouts)
  // Keep the drop target locked while Muuri runs its release animation.
  const activeLayouts = previewLayouts || releaseLayouts || projectedLayouts || baseLayouts
  activeLayoutsRef.current = activeLayouts

  const clearPreviewLayouts = React.useCallback(() => setPreviewLayoutsState(null), [])
  const clearReleaseLayouts = React.useCallback(() => setReleaseLayoutsState(null), [])
  const resetTransientLayouts = React.useCallback(() => {
    setPreviewLayoutsState(null)
    setProjectedLayoutsState(null)
    setReleaseLayoutsState(null)
  }, [])
  const setProjectedLayouts = React.useCallback((layouts: TLayoutMap | null) => {
    activeLayoutsRef.current = previewLayouts || releaseLayouts || layouts || baseLayouts
    setProjectedLayoutsState(layouts)
  }, [baseLayouts, previewLayouts, releaseLayouts])
  const setPreviewLayouts = React.useCallback((layouts: TLayoutMap) => {
    setPreviewLayoutsState(layouts)
  }, [])
  const lockReleaseLayouts = React.useCallback((layouts: TLayoutMap) => {
    activeLayoutsRef.current = layouts
    setReleaseLayoutsState(layouts)
  }, [])

  return {
    activeLayouts,
    activeLayoutsRef,
    clearPreviewLayouts,
    clearReleaseLayouts,
    lockReleaseLayouts,
    resetTransientLayouts,
    setProjectedLayouts,
    setPreviewLayouts,
  }
}
