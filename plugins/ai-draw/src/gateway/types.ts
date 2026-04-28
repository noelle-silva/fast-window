import type {
  AiDrawCreateLocalEditGenerationRequest,
  AiDrawCreateNormalGenerationRequest,
  AiDrawGenerationEvent,
  AiDrawGenerationTask,
  AiDrawSettingsV1,
  AiDrawTaskHistoryItem,
  PromptLibraryV1,
  RefLibraryIndexV1,
} from '../shared/domain'

export type AiDrawPickedImage = {
  name: string
  dataUrl: string
  sourcePath?: string
}

export type AiDrawGateway = {
  runtime: 'ui'

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

  generation: {
    createNormal: (req: AiDrawCreateNormalGenerationRequest) => Promise<AiDrawGenerationTask[]>
    createLocalEdit: (req: AiDrawCreateLocalEditGenerationRequest) => Promise<AiDrawGenerationTask>
    get: (taskId: string) => Promise<AiDrawGenerationTask | null>
    list: (limit?: number | null) => Promise<AiDrawGenerationTask[]>
    cancel: (taskId: string) => Promise<void>
    subscribe: (listener: (event: AiDrawGenerationEvent) => void) => () => void
  }

  close?: () => void
}
