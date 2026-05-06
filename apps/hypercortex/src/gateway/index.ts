import { createAssetsService } from '../services/assetsService'
import { createFavoritesService } from '../services/favoritesService'
import { createMetadataService } from '../services/metadataService'
import { createNotesService } from '../services/notesService'
import { createRefsService } from '../services/refsService'
import { createTrashService } from '../services/trashService'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { createBackgroundClient } from './backgroundClient'
import { createClipboardGateway } from './clipboardGateway'
import { createHostGateway } from './hostGateway'
import { HyperCortexRpc } from '../shared/rpcMethods'
import type { BackgroundClient } from './backgroundClient'
import type { DataDirStatus, HyperCortexGateway, LegacyDataImportResult } from './types'

let gatewayCache: HyperCortexGateway | null = null
let gatewayPromise: Promise<HyperCortexGateway> | null = null

export async function createHyperCortexGateway(): Promise<HyperCortexGateway> {
  const baseApi = createHyperCortexAppHostApi()
  const background = await createBackgroundClient(baseApi)
  const hostApi = withAppHostMethods(baseApi, background)
  const host = createHostGateway(hostApi, background)
  const clipboard = createClipboardGateway(hostApi)

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

function withAppHostMethods(baseApi: any, background: BackgroundClient) {
  return {
    ...baseApi,
    host: {
      ...(baseApi.host || {}),
      getDataDirStatus: () => invoke<DataDirStatus>('data_dir_status'),
      pickDataDir: () => invoke<DataDirStatus | null>('pick_data_dir'),
      importLegacyData: async (): Promise<LegacyDataImportResult | null> => {
        const selection = await invoke<{ dir: string } | null>('pick_legacy_data_dir')
        const dir = String(selection?.dir || '').trim()
        if (!dir) return null
        const result = await background.invoke<Omit<LegacyDataImportResult, 'sourceDir'>>(HyperCortexRpc.host.importLegacyData, { dir })
        return { sourceDir: dir, ...result }
      },
    },
  }
}

function createHyperCortexAppHostApi() {
  return {
    __meta: { runtime: 'ui', appId: 'hypercortex' },
    background: {
      endpoint: async () => {
        const endpoint = await invoke<{ url: string; token: string }>('backend_endpoint')
        return {
          mode: 'direct',
          transport: 'local-websocket',
          protocolVersion: 1,
          url: endpoint.url,
          token: endpoint.token,
        }
      },
    },
    ui: {
      startDragging: () => getCurrentWindow().startDragging(),
    },
    host: {
      back: () => getCurrentWindow().hide(),
      writeClipboardText: (text: string) => invoke('write_clipboard_text', { text: String(text ?? '') }),
    },
  }
}

export async function getHyperCortexGateway(): Promise<HyperCortexGateway> {
  if (gatewayCache) return gatewayCache
  if (!gatewayPromise) gatewayPromise = createHyperCortexGateway()
  gatewayCache = await gatewayPromise
  return gatewayCache
}

export function resetHyperCortexGateway() {
  gatewayCache = null
  gatewayPromise = null
}

export type { DataDirStatus, HyperCortexGateway, HyperCortexHtmlFaceDoc, HyperCortexTrashItem, LegacyDataImportResult } from './types'
