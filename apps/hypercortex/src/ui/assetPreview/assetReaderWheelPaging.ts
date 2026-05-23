import { attachAssetReaderWheelListener, claimAssetReaderWheelEvent, dominantAssetReaderWheelDelta, isAssetReaderModifierWheel, isInteractiveAssetReaderWheelTarget, normalizeAssetReaderWheelDelta, READER_WHEEL_DELTA_PAGE } from './assetReaderWheelInput'

const WHEEL_PAGE_DELTA_UNIT = 120
const DISCRETE_PIXEL_WHEEL_MIN_DELTA = 4

type WheelPageDirection = 'previous' | 'next'

type AssetReaderWheelPagingOptions = {
  surface: HTMLElement
  canPrevious: () => boolean
  canNext: () => boolean
  onPreviousPage: () => Promise<void> | void
  onNextPage: () => Promise<void> | void
  onError: (message: string) => void
  errorMessage: string
}

export type AssetReaderWheelPagingHandle = {
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

function canTurnPage(direction: WheelPageDirection, canPrevious: () => boolean, canNext: () => boolean): boolean {
  return direction === 'next' ? canNext() : canPrevious()
}

export function attachAssetReaderWheelPaging({
  surface,
  canPrevious,
  canNext,
  onPreviousPage,
  onNextPage,
  onError,
  errorMessage,
}: AssetReaderWheelPagingOptions): AssetReaderWheelPagingHandle {
  const turnQueue: WheelPageDirection[] = []
  let wheelDeltaRemainder = 0
  let drainingTurnQueue = false
  let destroyed = false

  const runPageTurn = async (direction: WheelPageDirection) => {
    if (destroyed || !canTurnPage(direction, canPrevious, canNext)) return
    try {
      await (direction === 'next' ? onNextPage() : onPreviousPage())
    } catch (e: any) {
      onError(String(e?.message || e || errorMessage))
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

  const enqueuePageTurns = (direction: WheelPageDirection, count: number) => {
    if (destroyed || !canTurnPage(direction, canPrevious, canNext)) return
    for (let i = 0; i < count; i += 1) turnQueue.push(direction)
    drainTurnQueue()
  }

  const onWheel = (event: WheelEvent) => {
    if (isAssetReaderModifierWheel(event) || isInteractiveAssetReaderWheelTarget(event.target)) return
    const rawDelta = dominantAssetReaderWheelDelta(event)
    const delta = normalizeAssetReaderWheelDelta(event, rawDelta, surface)
    if (!delta) return

    claimAssetReaderWheelEvent(event)

    if (isDiscreteWheelStep(event, rawDelta, delta)) {
      wheelDeltaRemainder = 0
      enqueuePageTurns(delta > 0 ? 'next' : 'previous', discreteWheelPageTurnCount(event, rawDelta, delta))
      return
    }

    wheelDeltaRemainder = Math.sign(wheelDeltaRemainder) === Math.sign(delta) ? wheelDeltaRemainder + delta : delta
    const pageTurnCount = Math.trunc(Math.abs(wheelDeltaRemainder) / WHEEL_PAGE_DELTA_UNIT)
    if (pageTurnCount <= 0) return

    const direction: WheelPageDirection = wheelDeltaRemainder > 0 ? 'next' : 'previous'
    wheelDeltaRemainder = Math.sign(wheelDeltaRemainder) * (Math.abs(wheelDeltaRemainder) - pageTurnCount * WHEEL_PAGE_DELTA_UNIT)
    enqueuePageTurns(direction, pageTurnCount)
  }

  const wheelListener = attachAssetReaderWheelListener(surface, onWheel)

  return {
    destroy: () => {
      destroyed = true
      turnQueue.length = 0
      wheelListener.destroy()
    },
  }
}
