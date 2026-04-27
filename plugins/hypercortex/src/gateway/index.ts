import { createAssetsService } from '../services/assetsService'
import { createFavoritesService } from '../services/favoritesService'
import { createMetadataService } from '../services/metadataService'
import { createNotesService } from '../services/notesService'
import { createRefsService } from '../services/refsService'
import { createTrashService } from '../services/trashService'
import { createBackgroundClient } from './backgroundClient'
import { createClipboardGateway } from './clipboardGateway'
import { createHostGateway } from './hostGateway'
import type { HyperCortexGateway } from './types'

let gatewayCache: HyperCortexGateway | null = null

export function createHyperCortexGateway(baseApi: any): HyperCortexGateway {
  const background = createBackgroundClient(baseApi)
  const host = createHostGateway(baseApi, background)
  const clipboard = createClipboardGateway(baseApi)

  return {
    host,
    clipboard,
    refs: createRefsService(background),
    metadata: createMetadataService(background),
    notes: createNotesService(background),
    assets: createAssetsService(background),
    favorites: createFavoritesService(background),
    trash: createTrashService(background),
  }
}

export function getHyperCortexGateway(): HyperCortexGateway {
  if (gatewayCache) return gatewayCache
  gatewayCache = createHyperCortexGateway((window as any).fastWindow)
  return gatewayCache
}

export type { HyperCortexGateway, HyperCortexHtmlFaceDoc, HyperCortexTrashItem } from './types'
