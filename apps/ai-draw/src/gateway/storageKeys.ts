export const AI_DRAW_STORAGE_KEYS = {
  settings: 'settings',
  taskHistory: 'taskHistory',
  bgSavedResults: 'bgSavedResults',
  bgSaveRequests: 'bgSaveRequests',
  bgSaveResponses: 'bgSaveResponses',
  promptLibrary: 'promptLibrary',
  refLibraryIndex: 'refLibraryIndex',
  refImages: 'refImages',
  refImageHistory: 'refImageHistory',
} as const

export type AiDrawStorageKey = keyof typeof AI_DRAW_STORAGE_KEYS
