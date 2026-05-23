import type { Contents as EpubContents, Rendition } from 'epubjs'
import { attachAssetReaderWheelPaging, type AssetReaderWheelPagingHandle } from './assetReaderWheelPaging'

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
  const wheelPagingHandles = new Set<AssetReaderWheelPagingHandle>()

  const createWheelPaging = (wheelSurface: HTMLElement) => {
    const handle = attachAssetReaderWheelPaging({
      surface: wheelSurface,
      canPrevious: () => true,
      canNext: () => true,
      onPreviousPage,
      onNextPage,
      onError,
      errorMessage: 'EPUB 滚轮翻页失败',
    })
    wheelPagingHandles.add(handle)
    return handle
  }

  const bindContentWheel = (contents: EpubContents | null | undefined) => {
    if (!contents || unbindContentWheel.has(contents)) return
    const document = contents.document
    if (!document) return

    const handle = createWheelPaging(document.documentElement)
    unbindContentWheel.set(contents, () => {
      handle.destroy()
      wheelPagingHandles.delete(handle)
    })
  }

  const unbindContent = (contents: EpubContents | null | undefined) => {
    if (!contents) return
    unbindContentWheel.get(contents)?.()
    unbindContentWheel.delete(contents)
  }

  const onRendered = (_section: unknown, view: EpubRenderedView | null | undefined) => bindContentWheel(view?.contents)
  const onRemoved = (_section: unknown, view: EpubRenderedView | null | undefined) => unbindContent(view?.contents)

  const surfaceWheelPaging = createWheelPaging(surface)
  rendition.on('rendered', onRendered)
  rendition.on('removed', onRemoved)
  getRenderedContents(rendition).forEach(bindContentWheel)

  return {
    destroy: () => {
      surfaceWheelPaging.destroy()
      rendition.off('rendered', onRendered)
      rendition.off('removed', onRemoved)
      unbindContentWheel.forEach(cleanup => cleanup())
      unbindContentWheel.clear()
      wheelPagingHandles.forEach(handle => handle.destroy())
      wheelPagingHandles.clear()
    },
  }
}
