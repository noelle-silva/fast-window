import type { Contents as EpubContents, Rendition } from 'epubjs'
import { dominantAssetReaderWheelDelta, isInteractiveAssetReaderWheelTarget, normalizeAssetReaderWheelDelta, READER_WHEEL_DELTA_PAGE } from './assetReaderWheelInput'

const WHEEL_PAGE_DELTA_UNIT = 120
const DISCRETE_PIXEL_WHEEL_MIN_DELTA = 4

type WheelDirection = 'previous' | 'next'

type EpubWheelNavigationOptions = {
  rendition: Rendition
  surface: HTMLElement
  onPreviousPage: () => Promise<void> | void
  onNextPage: () => Promise<void> | void
  onError: (message: string) => void
}

type EpubRenderedView = {
  contents?: EpubContents | null
}

export type EpubWheelNavigationHandle = {
  destroy: () => void
}

function isDiscreteWheelStep(event: WheelEvent, rawDelta: number, normalizedDelta: number): boolean {
  if (event.deltaMode !== 0) return true
  return Number.isInteger(rawDelta) && Math.abs(normalizedDelta) >= DISCRETE_PIXEL_WHEEL_MIN_DELTA
}

function discreteWheelPageTurnCount(event: WheelEvent, rawDelta: number, normalizedDelta: number): number {
  if (event.deltaMode === READER_WHEEL_DELTA_PAGE) return Math.max(1, Math.round(Math.abs(rawDelta)))
  return Math.max(1, Math.round(Math.abs(normalizedDelta) / WHEEL_PAGE_DELTA_UNIT))
}

function getRenderedContents(rendition: Rendition): EpubContents[] {
  const contents = rendition.getContents() as unknown
  if (Array.isArray(contents)) return contents.filter(Boolean) as EpubContents[]
  return contents ? [contents as EpubContents] : []
}

export function attachEpubWheelNavigation({
  rendition,
  surface,
  onPreviousPage,
  onNextPage,
  onError,
}: EpubWheelNavigationOptions): EpubWheelNavigationHandle {
  const unbindContentWheel = new Map<EpubContents, () => void>()
  const turnQueue: WheelDirection[] = []
  let wheelDeltaRemainder = 0
  let drainingTurnQueue = false
  let destroyed = false

  const runPageTurn = async (direction: WheelDirection) => {
    if (destroyed) return
    try {
      await (direction === 'next' ? onNextPage() : onPreviousPage())
    } catch (e: any) {
      onError(String(e?.message || e || 'EPUB 滚轮翻页失败'))
    }
  }

  const drainTurnQueue = () => {
    if (drainingTurnQueue) return
    drainingTurnQueue = true
    void (async () => {
      try {
        while (!destroyed && turnQueue.length) {
          const direction = turnQueue.shift()
          if (direction) await runPageTurn(direction)
        }
      } finally {
        drainingTurnQueue = false
      }
    })()
  }

  const enqueuePageTurns = (direction: WheelDirection, count: number) => {
    if (destroyed) return
    for (let i = 0; i < count; i += 1) turnQueue.push(direction)
    drainTurnQueue()
  }

  const onWheel = (event: WheelEvent) => {
    if (event.ctrlKey || event.metaKey || isInteractiveAssetReaderWheelTarget(event.target)) return
    const rawDelta = dominantAssetReaderWheelDelta(event)
    const delta = normalizeAssetReaderWheelDelta(event, rawDelta, surface)
    if (!delta) return

    event.preventDefault()
    event.stopPropagation()

    if (isDiscreteWheelStep(event, rawDelta, delta)) {
      wheelDeltaRemainder = 0
      enqueuePageTurns(delta > 0 ? 'next' : 'previous', discreteWheelPageTurnCount(event, rawDelta, delta))
      return
    }

    wheelDeltaRemainder = Math.sign(wheelDeltaRemainder) === Math.sign(delta) ? wheelDeltaRemainder + delta : delta
    const pageTurnCount = Math.trunc(Math.abs(wheelDeltaRemainder) / WHEEL_PAGE_DELTA_UNIT)
    if (pageTurnCount <= 0) return

    const direction: WheelDirection = wheelDeltaRemainder > 0 ? 'next' : 'previous'
    wheelDeltaRemainder = Math.sign(wheelDeltaRemainder) * (Math.abs(wheelDeltaRemainder) - pageTurnCount * WHEEL_PAGE_DELTA_UNIT)
    enqueuePageTurns(direction, pageTurnCount)
  }

  const bindContentWheel = (contents: EpubContents | null | undefined) => {
    if (!contents || unbindContentWheel.has(contents)) return
    const document = contents.document
    if (!document) return

    document.addEventListener('wheel', onWheel, { passive: false, capture: true })
    unbindContentWheel.set(contents, () => document.removeEventListener('wheel', onWheel, true))
  }

  const unbindContent = (contents: EpubContents | null | undefined) => {
    if (!contents) return
    unbindContentWheel.get(contents)?.()
    unbindContentWheel.delete(contents)
  }

  const onRendered = (_section: unknown, view: EpubRenderedView | null | undefined) => bindContentWheel(view?.contents)
  const onRemoved = (_section: unknown, view: EpubRenderedView | null | undefined) => unbindContent(view?.contents)

  surface.addEventListener('wheel', onWheel, { passive: false })
  rendition.on('rendered', onRendered)
  rendition.on('removed', onRemoved)
  getRenderedContents(rendition).forEach(bindContentWheel)

  return {
    destroy: () => {
      destroyed = true
      turnQueue.length = 0
      surface.removeEventListener('wheel', onWheel)
      rendition.off('rendered', onRendered)
      rendition.off('removed', onRemoved)
      unbindContentWheel.forEach(cleanup => cleanup())
      unbindContentWheel.clear()
    },
  }
}
