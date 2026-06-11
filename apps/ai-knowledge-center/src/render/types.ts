export type BoolRef = { value: boolean }

export type RenderSafetyPolicy = 'original' | 'baseline' | 'unsafe'

export type KnowledgeRenderCapabilities = {
  clipboard?: {
    writeText?: (text: any) => Promise<void>
    writeImage?: (dataUrl: any) => Promise<void>
  }
  ui?: {
    showToast?: (message: any) => void
  }
  files?: {
    images?: {
      read?: (req: any) => Promise<any>
    }
  }
}

export type AssistantRenderOptions = {
  stickersEnabled?: boolean
  getStickerPath?: (category: string, name: string) => string
  renderSafetyPolicy?: RenderSafetyPolicy
}
