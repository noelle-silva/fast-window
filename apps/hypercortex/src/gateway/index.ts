import { createAssetsService } from '../services/assetsService'
import { createFavoritesService } from '../services/favoritesService'
import { createMetadataService } from '../services/metadataService'
import { createNotesService } from '../services/notesService'
import { createRefsService } from '../services/refsService'
import { createRepoStateService } from '../services/repoStateService'
import { createReposService } from '../services/reposService'
import { createSearchService } from '../services/searchService'
import { createTrashService } from '../services/trashService'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { createBackgroundClient } from './backgroundClient'
import { createClipboardGateway } from './clipboardGateway'
import { createHostGateway } from './hostGateway'
import { bindRepoScope } from './repoScope'
import { HyperCortexRpc } from '../shared/rpcMethods'
import type { BackgroundClient } from './backgroundClient'
import type { DataDirStatus, HyperCortexGateway, LegacyDataImportResult } from './types'

let gatewayCache: HyperCortexGateway | null = null
let gatewayPromise: Promise<HyperCortexGateway> | null = null

// 共享传输：后台连接全局一份，仓库作用域通过按仓库绑定的客户端表达。
type GatewayTransport = { baseApi: any; background: BackgroundClient }
let sharedTransport: GatewayTransport | null = null

export async function createHyperCortexGateway(): Promise<HyperCortexGateway> {
  const baseApi = createHyperCortexAppHostApi()
  const background = await createBackgroundClient(baseApi)
  sharedTransport = { baseApi, background }
  return assembleHyperCortexGateway(sharedTransport, '')
}

// createRepoScopedGateway 为具体仓库创建专属网关：
// 现场内所有仓库作用域请求固定解析到该仓库，多个现场并存时互不串仓。
export function createRepoScopedGateway(repoId: string): HyperCortexGateway {
  const id = String(repoId || '').trim()
  if (!id) throw new Error('仓库标识不能为空')
  if (!sharedTransport) throw new Error('HyperCortex 网关尚未创建')
  return assembleHyperCortexGateway(sharedTransport, id)
}

// 外壳网关不绑定仓库：仓库作用域请求快速失败，从结构上禁止无归属的写入。
function assembleHyperCortexGateway(transport: GatewayTransport, repoId: string): HyperCortexGateway {
  const scopedBackground = bindRepoScope(transport.background, repoId)
  const hostApi = withAppHostMethods(transport.baseApi, transport.background)
  const host = createHostGateway(hostApi, scopedBackground)
  const clipboard = createClipboardGateway(hostApi)

  return {
    host,
    clipboard,
    repos: createReposService(scopedBackground),
    refs: createRefsService(scopedBackground),
    search: createSearchService(scopedBackground),
    metadata: createMetadataService(scopedBackground),
    notes: createNotesService(scopedBackground),
    assets: createAssetsService(scopedBackground),
    favorites: createFavoritesService(scopedBackground),
    repoState: createRepoStateService(scopedBackground),
    trash: createTrashService(scopedBackground),
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

export type { DataDirStatus, HyperCortexDeletedRepo, HyperCortexGateway, HyperCortexRepo, HyperCortexTrashItem, LegacyDataImportResult } from './types'
