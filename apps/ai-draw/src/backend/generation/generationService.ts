import { AI_DRAW_ERROR_CODE, AiDrawDirectError } from '../../shared/errors'
import type { AiDrawCreateLocalEditGenerationRequest, AiDrawCreateNormalGenerationRequest } from '../../shared/domain'
import type { ImageStore } from '../images/imageStore'
import { requestOpenAiImage } from './openAiImageProvider'
import { createTaskRegistry, type TaskRegistry } from './taskRegistry'

export type GenerationService = {
  registry: TaskRegistry
  createNormal(params: unknown): Promise<{ tasks: ReturnType<TaskRegistry['list']> }>
  createLocalEdit(params: unknown): Promise<{ task: NonNullable<ReturnType<TaskRegistry['get']>> }>
  get(params: unknown): Promise<{ task: ReturnType<TaskRegistry['get']> }>
  list(params: unknown): Promise<{ tasks: ReturnType<TaskRegistry['list']> }>
  cancel(params: unknown): Promise<null>
  dispose(): void
}

function providerSnapshot(req: AiDrawCreateNormalGenerationRequest | AiDrawCreateLocalEditGenerationRequest) {
  const provider = req.provider
  const model = String(provider?.customModel || provider?.model || provider?.models?.[0] || '').trim()
  return { providerId: String(provider?.id || '').trim(), providerName: String(provider?.name || '').trim(), model }
}

export function createGenerationService(outputStore: ImageStore): GenerationService {
  const registry = createTaskRegistry()

  async function runTask(taskId: string, request: AiDrawCreateNormalGenerationRequest | AiDrawCreateLocalEditGenerationRequest) {
    const task = registry.get(taskId)
    if (!task) return
    registry.update(taskId, { status: 'running' })
    try {
      const result = await requestOpenAiImage({ taskId, mode: task.mode, request, signal: task.abortController.signal })
      let savedPath = ''
      if (request.autoSave) savedPath = await outputStore.saveBase64(result.imageDataUrl)
      registry.update(taskId, {
        status: 'succeeded',
        imageDataUrl: request.autoSave ? '' : result.imageDataUrl,
        savedPath,
        debug: result.debug,
      })
    } catch (error: any) {
      const aborted = task.abortController.signal.aborted
      registry.update(taskId, {
        status: aborted ? 'canceled' : 'failed',
        error: aborted ? '已取消' : String(error?.message || error || '生成失败'),
        debug: error?.debug || task.debug || null,
      })
    }
  }

  return {
    registry,
    async createNormal(params) {
      const request = (params as any)?.request as AiDrawCreateNormalGenerationRequest
      if (!request || typeof request !== 'object') throw new AiDrawDirectError(AI_DRAW_ERROR_CODE.badRequest, 'generation.createNormal 参数无效')
      const batchCount = Math.max(1, Math.min(20, Math.floor(Number(request.batchCount) || 1)))
      const snap = providerSnapshot(request)
      const tasks = Array.from({ length: batchCount }, () => registry.create({ mode: 'normal', prompt: String(request.prompt || ''), ...snap }))
      for (const task of tasks) void runTask(task.id, { ...request, batchCount: 1 })
      return { tasks }
    },
    async createLocalEdit(params) {
      const request = (params as any)?.request as AiDrawCreateLocalEditGenerationRequest
      if (!request || typeof request !== 'object') throw new AiDrawDirectError(AI_DRAW_ERROR_CODE.badRequest, 'generation.createLocalEdit 参数无效')
      const task = registry.create({ mode: 'local-edit', prompt: String(request.prompt || ''), ...providerSnapshot(request) })
      void runTask(task.id, request)
      return { task }
    },
    async get(params) {
      return { task: registry.get(String((params as any)?.taskId || '')) }
    },
    async list(params) {
      return { tasks: registry.list((params as any)?.limit) }
    },
    async cancel(params) {
      const ok = registry.cancel(String((params as any)?.taskId || ''))
      if (!ok) throw new AiDrawDirectError(AI_DRAW_ERROR_CODE.taskNotFound, '任务不存在')
      return null
    },
    dispose() {
      registry.dispose()
    },
  }
}
