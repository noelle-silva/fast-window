import type { Contents as EpubContents, Rendition } from 'epubjs'

const WHEEL_PAGE_DELTA_UNIT = 48
const WHEEL_DELTA_LINE = 1
const WHEEL_DELTA_PAGE = 2
const WHEEL_LINE_HEIGHT = 40
const INTERACTIVE_WHEEL_TARGET_SELECTOR = 'input, textarea, select, button, [role="button"], [contenteditable="true"], [data-epub-wheel-ignore]'

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

function closestWheelTarget(target: EventTarget | null): { closest: (selector: string) => Element | null } | null {
  if (!target || typeof (target as { closest?: unknown }).closest !== 'function') return null
  return target as { closest: (selector: string) => Element | null }
}

function isInteractiveWheelTarget(target: EventTarget | null): boolean {
  return Boolean(closestWheelTarget(target)?.closest(INTERACTIVE_WHEEL_TARGET_SELECTOR))
}

function normalizeWheelDelta(event: WheelEvent, surface: HTMLElement): number {
  const dominantDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
  if (!Number.isFinite(dominantDelta) || dominantDelta === 0) return 0
  if (event.deltaMode === WHEEL_DELTA_LINE) return dominantDelta * WHEEL_LINE_HEIGHT
  if (event.deltaMode === WHEEL_DELTA_PAGE) return dominantDelta * Math.max(surface.clientHeight, 1)
  return dominantDelta
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
    if (event.ctrlKey || event.metaKey || isInteractiveWheelTarget(event.target)) return
    const delta = normalizeWheelDelta(event, surface)
    if (!delta) return

    event.preventDefault()
    event.stopPropagation()

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
