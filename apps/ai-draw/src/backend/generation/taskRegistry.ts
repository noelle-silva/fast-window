import { AI_DRAW_DIRECT_EVENT } from '../../shared/protocol'
import type { AiDrawDirectEvent } from '../../shared/protocol'
import type { AiDrawGenerationDebugRecord, AiDrawGenerationMode, AiDrawGenerationStatus, AiDrawGenerationTask } from '../../shared/domain'
import { id } from '../../core/utils'

export type BackendGenerationTask = AiDrawGenerationTask & {
  providerId: string
  providerName: string
  model: string
  abortController: AbortController
}

export type TaskRegistry = {
  create(input: { mode: AiDrawGenerationMode; prompt: string; providerId: string; providerName: string; model: string }): BackendGenerationTask
  get(taskId: string): BackendGenerationTask | null
  list(limit?: number | null): BackendGenerationTask[]
  update(taskId: string, patch: Partial<Omit<BackendGenerationTask, 'id' | 'abortController'>>): BackendGenerationTask | null
  cancel(taskId: string): boolean
  subscribe(listener: (event: AiDrawDirectEvent) => void): () => void
  dispose(): void
}

function publicTask(task: BackendGenerationTask): AiDrawGenerationTask {
  const { abortController, providerId, providerName, model, ...rest } = task
  void abortController
  void providerId
  void providerName
  void model
  return rest
}

function eventNameForStatus(status: AiDrawGenerationStatus) {
  if (status === 'succeeded') return AI_DRAW_DIRECT_EVENT.generationCompleted
  if (status === 'failed') return AI_DRAW_DIRECT_EVENT.generationFailed
  if (status === 'canceled') return AI_DRAW_DIRECT_EVENT.generationCanceled
  return AI_DRAW_DIRECT_EVENT.generationProgress
}

export function createTaskRegistry(): TaskRegistry {
  const tasks = new Map<string, BackendGenerationTask>()
  const listeners = new Set<(event: AiDrawDirectEvent) => void>()

  function emit(event: AiDrawDirectEvent) {
    for (const listener of listeners) listener(event)
  }

  return {
    create(input) {
      const now = Date.now()
      const task: BackendGenerationTask = {
        id: id('gen'),
        mode: input.mode,
        status: 'pending',
        prompt: input.prompt,
        createdAt: now,
        updatedAt: now,
        providerId: input.providerId,
        providerName: input.providerName,
        model: input.model,
        debug: null,
        abortController: new AbortController(),
      }
      tasks.set(task.id, task)
      emit({ type: 'event', name: AI_DRAW_DIRECT_EVENT.generationCreated, payload: { task: publicTask(task) } })
      return task
    },
    get(taskId) {
      return tasks.get(String(taskId || '').trim()) || null
    },
    list(limit) {
      const n = Number(limit)
      const safeLimit = Number.isFinite(n) && n > 0 ? Math.floor(n) : 50
      return Array.from(tasks.values()).sort((a, b) => b.createdAt - a.createdAt).slice(0, safeLimit)
    },
    update(taskId, patch) {
      const task = tasks.get(String(taskId || '').trim())
      if (!task) return null
      Object.assign(task, patch, { updatedAt: Date.now() })
      emit({ type: 'event', name: eventNameForStatus(task.status), payload: { task: publicTask(task) } })
      return task
    },
    cancel(taskId) {
      const task = tasks.get(String(taskId || '').trim())
      if (!task) return false
      if (task.status === 'succeeded' || task.status === 'failed' || task.status === 'canceled') return true
      task.abortController.abort()
      this.update(task.id, { status: 'canceling' })
      return true
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispose() {
      for (const task of tasks.values()) task.abortController.abort()
      listeners.clear()
    },
  }
}

export function attachTaskDebug(task: BackendGenerationTask, debug: AiDrawGenerationDebugRecord | null) {
  task.debug = debug
}
