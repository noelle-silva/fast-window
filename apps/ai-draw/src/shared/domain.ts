export type { AiDrawProvider, AiDrawSettingsV1, PromptLibraryV1, RefLibraryIndexV1 } from '../core/schema'
export type { AiDrawTaskHistoryItem } from '../core/taskHistory'

import type { AiDrawProvider } from '../core/schema'

export type AiDrawGenerationStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'canceled' | 'canceling'
export type AiDrawGenerationMode = 'normal' | 'local-edit'

export type AiDrawGenerationDebugRecord = {
  taskId: string
  mode: AiDrawGenerationMode
  providerId: string
  providerName: string
  model: string
  protocolKind: 'images' | 'images-edits' | 'chat'
  createdAt: number
  updatedAt: number
  request: {
    method: 'POST'
    url: string
    headers: Record<string, string>
    bodyText: string
    bodySummary?: string
    timeoutMs: number | null
  }
  response: {
    status: number | null
    bodyText: string
    errorText: string
  }
  attemptCount: number
}

export type AiDrawGenerationTask = {
  id: string
  mode: AiDrawGenerationMode
  status: AiDrawGenerationStatus
  prompt: string
  createdAt: number
  updatedAt: number
  imageDataUrl?: string
  savedPath?: string
  error?: string
  debug?: AiDrawGenerationDebugRecord | null
}

export type AiDrawGenerationRefImage = { name: string; dataUrl: string; sourcePath?: string }

export type AiDrawCreateNormalGenerationRequest = {
  provider: AiDrawProvider
  prompt: string
  refImages: AiDrawGenerationRefImage[]
  batchCount: number
  autoSave: boolean
  shrinkRefImages: boolean
  debugMode: boolean
  requestTimeoutSec: number
}

export type AiDrawCreateLocalEditGenerationRequest = {
  provider: AiDrawProvider
  prompt: string
  cropImage: { name: string; dataUrl: string; width: number; height: number }
  refImages: AiDrawGenerationRefImage[]
  autoSave: boolean
  shrinkRefImages: boolean
  debugMode: boolean
  requestTimeoutSec: number
}

export type AiDrawGenerationEvent =
  | { type: 'created'; task: AiDrawGenerationTask }
  | { type: 'progress'; task: AiDrawGenerationTask; message?: string; progress?: number | null }
  | { type: 'completed'; task: AiDrawGenerationTask }
  | { type: 'failed'; task: AiDrawGenerationTask }
  | { type: 'canceled'; task: AiDrawGenerationTask }
