import type { AiDrawSettingsV1, PromptLibraryV1, RefLibraryIndexV1 } from '../core/schema'
import type { AiDrawTaskHistoryItem } from '../core/taskHistory'

export type AiDrawRuntimeKind = 'ui' | 'background'

export type AiDrawImageScope = 'data' | 'output'

export type AiDrawTaskStatus = 'pending' | 'succeeded' | 'failed' | 'canceled' | 'canceling'

export type AiDrawTaskKind = 'http.request' | string

export type AiDrawTaskResult = {
  status?: number
  body?: string
  attemptCount?: number
}

export type AiDrawTaskMeta = {
  tags?: string[]
  [key: string]: unknown
}

export type AiDrawTask = {
  id: string
  kind?: AiDrawTaskKind
  status: AiDrawTaskStatus | string
  result?: AiDrawTaskResult | null
  error?: string
  meta?: AiDrawTaskMeta | null
}

export type AiDrawPickedImage = {
  name: string
  dataUrl: string
  sourcePath?: string
}

export type AiDrawHttpRequest = {
  method: string
  url: string
  headers?: Record<string, string>
  body?: string
  bodyBase64?: string
  timeoutMs?: number | null
}

export type AiDrawCreateTaskRequest = {
  kind: AiDrawTaskKind
  payload: unknown
  meta?: AiDrawTaskMeta
}

export type AiDrawSaveRequestMap = Record<string, { dataUrl: string; at: number; by: 'ui' | 'background' | string }>
export type AiDrawSaveResponseMap = Record<string, { savedPath: string; at: number; by: 'ui' | 'background' | string }>
export type AiDrawSavedResultMap = Record<string, { savedPath: string; at: number; by: 'ui' | 'background' | string }>

export type AiDrawGateway = {
  runtime: AiDrawRuntimeKind

  host: {
    back: () => Promise<void>
    toast: (message: string) => void
    startDragging: () => Promise<void>
  }

  clipboard: {
    writeText: (text: string) => Promise<void>
    writeImage: (dataUrl: string) => Promise<void>
  }

  settingsStore: {
    read: () => Promise<AiDrawSettingsV1 | null>
    write: (settings: AiDrawSettingsV1) => Promise<void>
  }

  taskHistoryStore: {
    read: () => Promise<AiDrawTaskHistoryItem[] | null>
    write: (items: AiDrawTaskHistoryItem[]) => Promise<void>
  }

  promptLibraryStore: {
    read: () => Promise<PromptLibraryV1 | null>
    write: (library: PromptLibraryV1) => Promise<void>
  }

  referenceLibraryIndexStore: {
    read: () => Promise<RefLibraryIndexV1 | null>
    write: (index: RefLibraryIndexV1) => Promise<void>
  }

  backgroundSaveQueue: {
    readRequests: () => Promise<AiDrawSaveRequestMap>
    writeRequests: (map: AiDrawSaveRequestMap) => Promise<void>
    readResponses: () => Promise<AiDrawSaveResponseMap>
    writeResponses: (map: AiDrawSaveResponseMap) => Promise<void>
    readSavedResults: () => Promise<AiDrawSavedResultMap>
    writeSavedResults: (map: AiDrawSavedResultMap) => Promise<void>
  }

  outputImages: {
    getOutputDir: () => Promise<string>
    pickOutputDir: () => Promise<string | null>
    openOutputDir: () => Promise<void>
    list: () => Promise<string[]>
    read: (path: string) => Promise<string>
    saveBase64: (dataUrlOrBase64: string) => Promise<string>
    delete: (path: string) => Promise<void>
  }

  referenceImages: {
    pick: (maxCount: number) => Promise<AiDrawPickedImage[]>
    list: () => Promise<string[]>
    read: (path: string) => Promise<string>
    saveBase64: (dataUrlOrBase64: string) => Promise<string>
    delete: (path: string) => Promise<void>
  }

  generationTasks: {
    requestHttpTask: (req: AiDrawHttpRequest) => Promise<AiDrawTask>
    create: (req: AiDrawCreateTaskRequest) => Promise<AiDrawTask>
    get: (taskId: string) => Promise<AiDrawTask | null>
    list: (limit?: number | null) => Promise<AiDrawTask[]>
    cancel: (taskId: string) => Promise<void>
  }
}
