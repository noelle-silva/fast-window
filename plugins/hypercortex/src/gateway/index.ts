import { createAssetsService } from '../services/assetsService'
import { createFavoritesService } from '../services/favoritesService'
import { createMetadataService } from '../services/metadataService'
import { createNotesService } from '../services/notesService'
import { createRefsService } from '../services/refsService'
import { createTrashService } from '../services/trashService'
import { createGatewayApiAdapter } from './apiAdapter'
import { createClipboardGateway } from './clipboardGateway'
import { createFileGateway } from './fileGateway'
import { createHostGateway } from './hostGateway'
import type { HyperCortexGateway } from './types'

let gatewayCache: HyperCortexGateway | null = null

export function createHyperCortexGateway(baseApi: any): HyperCortexGateway {
  const host = createHostGateway(baseApi)
  const files = createFileGateway(baseApi)
  const clipboard = createClipboardGateway(baseApi)
  const lowLevel = { host, files, clipboard }
  const api = createGatewayApiAdapter(lowLevel)

  return {
    ...lowLevel,
    refs: createRefsService(api),
    metadata: createMetadataService(api),
    notes: createNotesService(api),
    assets: createAssetsService(api, files),
    favorites: createFavoritesService(api),
    trash: createTrashService(api),
  }
}

export function getHyperCortexGateway(): HyperCortexGateway {
  if (gatewayCache) return gatewayCache
  gatewayCache = createHyperCortexGateway((window as any).fastWindow)
  return gatewayCache
}

export type { HyperCortexGateway, HyperCortexHtmlFaceDoc, HyperCortexTrashItem } from './types'
