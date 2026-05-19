import type { HyperCortexColorPreset } from './colorPresetTypes'

type PreviewBar = {
  id: string
  color: string
  width: number
}

export type HyperCortexColorPresetPreviewModel = {
  shell: {
    appBg: string
    surface: string
    codeBg: string
    text: string
    textMuted: string
    textSubtle: string
    shadow: string
  }
  headerBars: PreviewBar[]
  contentBars: PreviewBar[]
  emphasisBars: PreviewBar[]
  contrastBars: PreviewBar[]
}

export function createColorPresetPreviewModel(preset: HyperCortexColorPreset): HyperCortexColorPresetPreviewModel {
  const c = preset.colors
  return {
    shell: {
      appBg: c.appBg,
      surface: c.surface,
      codeBg: c.codeBg,
      text: c.text,
      textMuted: c.textMuted,
      textSubtle: c.textSubtle,
      shadow: c.shadow,
    },
    headerBars: [
      { id: 'primary', color: c.primary, width: 28 },
      { id: 'title', color: c.text, width: 48 },
      { id: 'meta', color: c.textSubtle, width: 28 },
    ],
    contentBars: [
      { id: 'title-line', color: c.text, width: 92 },
      { id: 'body-line', color: c.textMuted, width: 118 },
    ],
    emphasisBars: [
      { id: 'primary', color: c.primary, width: 38 },
      { id: 'primary-soft', color: c.primarySoft, width: 32 },
      { id: 'surface-muted', color: c.surfaceMuted, width: 26 },
    ],
    contrastBars: [
      { id: 'contrast-text', color: c.codeText, width: 44 },
      { id: 'contrast-muted', color: c.codeMuted, width: 34 },
      { id: 'contrast-primary', color: c.primary, width: 50 },
      { id: 'contrast-surface', color: c.surfaceMuted, width: 28 },
    ],
  }
}
