import * as React from 'react'
import { clearDesktopWallpaperSurface, drawDesktopWallpaperSurface } from './desktopWallpaperSurface'
import { normalizeDesktopWallpaperView } from './desktopWallpaperPresets'
import type { CollectionViewCategoryId, DesktopWallpaperView } from './types'

export type DesktopWallpaperSurfaceSlot = {
  categoryId: CollectionViewCategoryId
  url: string
  view: DesktopWallpaperView
}

type SurfaceSlot = {
  categoryId: CollectionViewCategoryId
  url: string
  view: DesktopWallpaperView
  generation: number
  loading: boolean
  source: CanvasImageSource | null
  imageWidth: number
  imageHeight: number
}

type Options = {
  slots: DesktopWallpaperSurfaceSlot[]
  frameWidth: number
  frameHeight: number
  pixelRatio: number
}

export function useDesktopWallpaperSurfaces(options: Options) {
  const { slots, frameWidth, frameHeight, pixelRatio } = options
  const slotsRef = React.useRef(new Map<CollectionViewCategoryId, SurfaceSlot>())
  const canvasesRef = React.useRef(new Map<CollectionViewCategoryId, HTMLCanvasElement>())
  const refCallbacksRef = React.useRef(new Map<CollectionViewCategoryId, (node: HTMLCanvasElement | null) => void>())
  const frameRef = React.useRef({ width: frameWidth, height: frameHeight, pixelRatio })
  const repaintFrameRef = React.useRef<number | null>(null)
  frameRef.current = { width: frameWidth, height: frameHeight, pixelRatio }

  const paint = React.useCallback((categoryId: CollectionViewCategoryId) => {
    const slot = slotsRef.current.get(categoryId)
    const canvas = canvasesRef.current.get(categoryId)
    if (!slot?.source || !canvas) return
    const frame = frameRef.current
    drawDesktopWallpaperSurface(canvas, slot.source, slot.imageWidth, slot.imageHeight, frame.width, frame.height, frame.pixelRatio, slot.view)
  }, [])

  const clearSurface = React.useCallback((categoryId: CollectionViewCategoryId) => {
    const canvas = canvasesRef.current.get(categoryId)
    if (canvas) clearDesktopWallpaperSurface(canvas)
  }, [])

  const loadSlot = React.useCallback(async (slot: SurfaceSlot) => {
    const generation = slot.generation + 1
    slot.generation = generation
    slot.loading = true
    const image = new Image()
    image.decoding = 'async'
    image.src = slot.url
    try {
      await image.decode()
    } catch {
      if (slotsRef.current.get(slot.categoryId) === slot && slot.generation === generation) slot.loading = false
      return
    }
    if (slotsRef.current.get(slot.categoryId) !== slot || slot.generation !== generation) return
    slot.loading = false
    slot.source = image
    slot.imageWidth = image.naturalWidth
    slot.imageHeight = image.naturalHeight
    paint(slot.categoryId)
  }, [paint])

  React.useEffect(() => {
    const current = slotsRef.current
    const wanted = new Map(slots.map(slot => [slot.categoryId, slot]))

    for (const categoryId of [...current.keys()]) {
      if (!wanted.has(categoryId)) current.delete(categoryId)
    }

    for (const [categoryId, requested] of wanted) {
      const view = normalizeDesktopWallpaperView(requested.view)
      const existing = current.get(categoryId)
      if (!existing) {
        const slot: SurfaceSlot = { categoryId, url: requested.url, view, generation: 0, loading: false, source: null, imageWidth: 0, imageHeight: 0 }
        current.set(categoryId, slot)
        void loadSlot(slot)
        continue
      }
      if (existing.url !== requested.url) {
        existing.url = requested.url
        existing.source = null
        existing.imageWidth = 0
        existing.imageHeight = 0
        clearSurface(categoryId)
        void loadSlot(existing)
        continue
      }
      if (existing.view.x !== view.x || existing.view.y !== view.y || existing.view.scale !== view.scale) {
        existing.view = view
        paint(categoryId)
        continue
      }
      if (!existing.source && !existing.loading) void loadSlot(existing)
    }
  }, [clearSurface, loadSlot, paint, slots])

  const scheduleRepaint = React.useCallback(() => {
    if (repaintFrameRef.current != null) return
    repaintFrameRef.current = window.requestAnimationFrame(() => {
      repaintFrameRef.current = null
      for (const categoryId of slotsRef.current.keys()) paint(categoryId)
    })
  }, [paint])

  React.useEffect(() => {
    scheduleRepaint()
  }, [frameHeight, frameWidth, pixelRatio, scheduleRepaint])

  React.useEffect(() => () => {
    if (repaintFrameRef.current != null) window.cancelAnimationFrame(repaintFrameRef.current)
    for (const slot of slotsRef.current.values()) {
      slot.generation += 1
      slot.loading = false
    }
  }, [])

  const setSurfaceCanvas = React.useCallback((categoryId: CollectionViewCategoryId) => {
    const callbacks = refCallbacksRef.current
    const cached = callbacks.get(categoryId)
    if (cached) return cached
    const callback = (node: HTMLCanvasElement | null) => {
      if (node) canvasesRef.current.set(categoryId, node)
      else canvasesRef.current.delete(categoryId)
      paint(categoryId)
    }
    callbacks.set(categoryId, callback)
    return callback
  }, [paint])

  return { setSurfaceCanvas }
}
