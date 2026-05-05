export const AI_DRAW_DIRECT_PROTOCOL_VERSION = 1

export const AI_DRAW_DIRECT_METHOD = {
  protocolHello: 'protocol.hello',
  settingsRead: 'settings.read',
  settingsWrite: 'settings.write',
  taskHistoryRead: 'taskHistory.read',
  taskHistoryWrite: 'taskHistory.write',
  promptLibraryRead: 'promptLibrary.read',
  promptLibraryWrite: 'promptLibrary.write',
  referenceLibraryRead: 'referenceLibrary.read',
  referenceLibraryWrite: 'referenceLibrary.write',
  outputImagesGetOutputDir: 'outputImages.getOutputDir',
  outputImagesList: 'outputImages.list',
  outputImagesRead: 'outputImages.read',
  outputImagesSaveBase64: 'outputImages.saveBase64',
  outputImagesDelete: 'outputImages.delete',
  referenceImagesList: 'referenceImages.list',
  referenceImagesRead: 'referenceImages.read',
  referenceImagesSaveBase64: 'referenceImages.saveBase64',
  referenceImagesDelete: 'referenceImages.delete',
  generationCreateNormal: 'generation.createNormal',
  generationCreateLocalEdit: 'generation.createLocalEdit',
  generationGet: 'generation.get',
  generationList: 'generation.list',
  generationCancel: 'generation.cancel',
} as const

export const AI_DRAW_DIRECT_EVENT = {
  generationCreated: 'generation.created',
  generationProgress: 'generation.progress',
  generationCompleted: 'generation.completed',
  generationFailed: 'generation.failed',
  generationCanceled: 'generation.canceled',
  imageSaved: 'image.saved',
  storageChanged: 'storage.changed',
} as const

export type AiDrawDirectMethod = (typeof AI_DRAW_DIRECT_METHOD)[keyof typeof AI_DRAW_DIRECT_METHOD]
export type AiDrawDirectEventName = (typeof AI_DRAW_DIRECT_EVENT)[keyof typeof AI_DRAW_DIRECT_EVENT]

export type AiDrawDirectRequest = {
  id: string
  type: 'request'
  method: AiDrawDirectMethod | string
  params?: unknown
}

export type AiDrawDirectResponse = {
  id: string
  type: 'response'
  ok: boolean
  result?: unknown
  error?: {
    code?: string
    message: string
    details?: unknown
  }
}

export type AiDrawDirectEvent = {
  type: 'event'
  name: AiDrawDirectEventName
  payload?: unknown
}
