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
let gatewayPromise: Promise<HyperCortexGateway> | null = null

export async function createHyperCortexGateway(baseApi: any): Promise<HyperCortexGateway> {
  const background = await createBackgroundClient(baseApi)
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

export async function getHyperCortexGateway(): Promise<HyperCortexGateway> {
  if (gatewayCache) return gatewayCache
  if (!gatewayPromise) gatewayPromise = createHyperCortexGateway((window as any).fastWindow)
  gatewayCache = await gatewayPromise
  return gatewayCache
}

export type { HyperCortexGateway, HyperCortexHtmlFaceDoc, HyperCortexTrashItem } from './types'
