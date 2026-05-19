import type { HyperCortexColorPresetIdV1 } from '../colorPresetIds'
import type { HyperCortexToneId } from './uiTones'

export type HyperCortexColorPresetColors = {
  appBg: string
  surface: string
  surfaceSoft: string
  surfaceMuted: string
  text: string
  textMuted: string
  textSubtle: string
  primary: string
  primarySoft: string
  primaryHover: string
  accentSage: string
  accentSky: string
  accentLavender: string
  accentClay: string
  accentButter: string
  danger: string
  dangerSoft: string
  success: string
  successSoft: string
  assetImage: string
  assetVideo: string
  assetPdf: string
  assetWord: string
  assetEpub: string
  assetFile: string
  codeBg: string
  codeText: string
  codeMuted: string
  codeControlBg: string
  syntaxRed: string
  syntaxAmber: string
  syntaxGreen: string
  syntaxPurple: string
  syntaxSky: string
  syntaxPink: string
  syntaxOrange: string
  syntaxTeal: string
  tones: Record<HyperCortexToneId, { bg: string; hover: string; fg: string }>
  shadow: string
  shadowStrong: string
}

export type HyperCortexColorPresetPreview = {
  selection: string
  badgeBg: string
  badgeFg: string
}

export type HyperCortexColorPreset = {
  id: HyperCortexColorPresetIdV1
  label: string
  description: string
  personality: {
    source: string
    expression: string
  }
  preview: HyperCortexColorPresetPreview
  colors: HyperCortexColorPresetColors
}
