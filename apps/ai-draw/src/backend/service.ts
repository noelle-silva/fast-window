import path from 'node:path'
import type { AiDrawDirectEvent } from '../shared/protocol'
import { AI_DRAW_DIRECT_METHOD, AI_DRAW_DIRECT_PROTOCOL_VERSION } from '../shared/protocol'
import { AI_DRAW_ERROR_CODE, AiDrawDirectError } from '../shared/errors'
import type { AiDrawBackendEnv } from './env'
import type { DirectRequestContext } from './directServer'
import { createNodeFileSystemPort } from './storage/fileSystemPort'
import { createJsonStore } from './storage/jsonStore'
import { createBackendShardedStorage } from './storage/shardedStorage'
import { createImageStore } from './images/imageStore'
import { createOutputImagesService } from './images/outputImagesService'
import { createReferenceImagesService } from './images/referenceImagesService'
import { createGenerationService } from './generation/generationService'

export type AiDrawBackendService = {
  dispatch(method: string, params: unknown, context?: DirectRequestContext): Promise<unknown>
  subscribe(listener: (event: AiDrawDirectEvent) => void): () => void
  dispose(): Promise<void>
}

export function createAiDrawBackendService(env: AiDrawBackendEnv): AiDrawBackendService {
  const fs = createNodeFileSystemPort()
  const jsonStore = createJsonStore(fs)
  const shards = createBackendShardedStorage({ dataDir: env.dataDir, filesDataDir: env.filesDataDir, store: jsonStore })
  const outputImages = createOutputImagesService(env.outputDir, createImageStore(env.outputDir, fs))
  const referenceImages = createReferenceImagesService(createImageStore(path.join(env.filesDataDir, 'reference-images'), fs))
  const generation = createGenerationService(createImageStore(env.outputDir, fs))
  const listeners = new Set<(event: AiDrawDirectEvent) => void>()
  const unsubscribeGeneration = generation.registry.subscribe((event) => {
    for (const listener of listeners) listener(event)
  })

  async function dispatch(method: string, params: unknown): Promise<unknown> {
    switch (method) {
      case AI_DRAW_DIRECT_METHOD.protocolHello: {
        const clientVersion = Number((params as any)?.clientProtocolVersion)
        if (clientVersion !== AI_DRAW_DIRECT_PROTOCOL_VERSION) {
          throw new AiDrawDirectError(AI_DRAW_ERROR_CODE.protocolVersionUnsupported, 'direct 协议版本不兼容')
        }
        return { serverProtocolVersion: AI_DRAW_DIRECT_PROTOCOL_VERSION, pluginId: 'ai-draw' }
      }
      case AI_DRAW_DIRECT_METHOD.settingsRead:
        return shards.read('settings')
      case AI_DRAW_DIRECT_METHOD.settingsWrite:
        await shards.write('settings', (params as any)?.settings ?? null)
        return null
      case AI_DRAW_DIRECT_METHOD.taskHistoryRead:
        return shards.read('taskHistory')
      case AI_DRAW_DIRECT_METHOD.taskHistoryWrite:
        await shards.write('taskHistory', (params as any)?.items ?? [])
        return null
      case AI_DRAW_DIRECT_METHOD.promptLibraryRead:
        return shards.read('promptLibrary')
      case AI_DRAW_DIRECT_METHOD.promptLibraryWrite:
        await shards.write('promptLibrary', (params as any)?.library ?? null)
        return null
      case AI_DRAW_DIRECT_METHOD.referenceLibraryRead:
        return shards.read('refLibraryIndex')
      case AI_DRAW_DIRECT_METHOD.referenceLibraryWrite:
        await shards.write('refLibraryIndex', (params as any)?.index ?? null)
        return null
      case AI_DRAW_DIRECT_METHOD.outputImagesGetOutputDir:
        return outputImages.getOutputDir()
      case AI_DRAW_DIRECT_METHOD.outputImagesList:
        return outputImages.list()
      case AI_DRAW_DIRECT_METHOD.outputImagesRead:
        return outputImages.read(params)
      case AI_DRAW_DIRECT_METHOD.outputImagesSaveBase64:
        return outputImages.saveBase64(params)
      case AI_DRAW_DIRECT_METHOD.outputImagesDelete:
        return outputImages.delete(params)
      case AI_DRAW_DIRECT_METHOD.referenceImagesList:
        return referenceImages.list()
      case AI_DRAW_DIRECT_METHOD.referenceImagesRead:
        return referenceImages.read(params)
      case AI_DRAW_DIRECT_METHOD.referenceImagesSaveBase64:
        return referenceImages.saveBase64(params)
      case AI_DRAW_DIRECT_METHOD.referenceImagesDelete:
        return referenceImages.delete(params)
      case AI_DRAW_DIRECT_METHOD.generationCreateNormal:
        return generation.createNormal(params)
      case AI_DRAW_DIRECT_METHOD.generationCreateLocalEdit:
        return generation.createLocalEdit(params)
      case AI_DRAW_DIRECT_METHOD.generationGet:
        return generation.get(params)
      case AI_DRAW_DIRECT_METHOD.generationList:
        return generation.list(params)
      case AI_DRAW_DIRECT_METHOD.generationCancel:
        return generation.cancel(params)
      default:
        throw new AiDrawDirectError(AI_DRAW_ERROR_CODE.methodNotFound, `未知方法：${method}`)
    }
  }

  return {
    dispatch,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async dispose() {
      unsubscribeGeneration()
      listeners.clear()
      generation.dispose()
    },
  }
}
