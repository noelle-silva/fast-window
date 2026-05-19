import { createTheme, type Theme } from '@mui/material/styles'
import type { HyperCortexColorPresetIdV1 } from '../core'
import { lineFreeComponentOverrides } from './pluginUiStyles'
import { HYPERCORTEX_TONES, type HyperCortexToneId } from './uiTones'

export type HyperCortexColorPreset = {
  id: HyperCortexColorPresetIdV1
  label: string
  description: string
  colors: {
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
}

export const DEFAULT_COLOR_PRESET_ID: HyperCortexColorPresetIdV1 = 'dopamine-soft'

export const HYPERCORTEX_COLOR_PRESETS: HyperCortexColorPreset[] = [
  {
    id: 'dopamine-soft',
    label: '柔和多巴胺',
    description: '低饱和纯色组合：奶油底、鼠尾草绿、雾蓝、薰衣草紫和陶土橙。',
    colors: {
      appBg: '#f7f0e4',
      surface: '#fffaf0',
      surfaceSoft: '#f1e8d8',
      surfaceMuted: '#e9dec9',
      text: '#332d24',
      textMuted: '#625846',
      textSubtle: '#837763',
      primary: '#6f8f72',
      primarySoft: '#dce8d4',
      primaryHover: '#cfdcc5',
      accentSage: '#c9d8b6',
      accentSky: '#c6dbe3',
      accentLavender: '#d8cfe2',
      accentClay: '#ddb9a3',
      accentButter: '#ead89a',
      danger: '#a95f50',
      dangerSoft: '#efd5ca',
      success: '#5f8a63',
      successSoft: '#dfead7',
      assetImage: '#557f8b',
      assetVideo: '#76658f',
      assetPdf: '#a95f50',
      assetWord: '#5f7f63',
      assetFile: '#6f746b',
      codeBg: '#2f332d',
      codeText: '#f5efe2',
      codeMuted: 'rgba(245,239,226,.58)',
      codeControlBg: 'rgba(245,239,226,.10)',
      syntaxRed: '#a95f50',
      syntaxAmber: '#8f7334',
      syntaxGreen: '#6f8f72',
      syntaxPurple: '#76658f',
      syntaxSky: '#557f8b',
      syntaxPink: '#9a6d80',
      syntaxOrange: '#a57252',
      syntaxTeal: '#5f8278',
      tones: {
        sage: { bg: '#dce8d4', hover: '#c9d8b6', fg: '#4f6f52' },
        sky: { bg: '#dbeaf0', hover: '#c6dbe3', fg: '#557f8b' },
        lavender: { bg: '#e7dff0', hover: '#d8cfe2', fg: '#76658f' },
        clay: { bg: '#efd8cb', hover: '#ddb9a3', fg: '#a57252' },
        butter: { bg: '#f2e6b4', hover: '#ead89a', fg: '#8f7334' },
      },
      shadow: 'rgba(71,61,45,.10)',
      shadowStrong: 'rgba(71,61,45,.16)',
    },
  },
]

export function normalizeColorPresetId(value: unknown): HyperCortexColorPresetIdV1 {
  const id = String(value || '').trim()
  return HYPERCORTEX_COLOR_PRESETS.some(preset => preset.id === id) ? (id as HyperCortexColorPresetIdV1) : DEFAULT_COLOR_PRESET_ID
}

export function getColorPreset(id: unknown): HyperCortexColorPreset {
  const normalized = normalizeColorPresetId(id)
  return HYPERCORTEX_COLOR_PRESETS.find(preset => preset.id === normalized) || HYPERCORTEX_COLOR_PRESETS[0]
}

export function colorPresetCssVars(preset: HyperCortexColorPreset): Record<string, string> {
  const c = preset.colors
  const vars: Record<string, string> = {
    '--hc-app-bg': c.appBg,
    '--hc-surface': c.surface,
    '--hc-surface-soft': c.surfaceSoft,
    '--hc-surface-muted': c.surfaceMuted,
    '--hc-text': c.text,
    '--hc-text-muted': c.textMuted,
    '--hc-text-subtle': c.textSubtle,
    '--hc-primary': c.primary,
    '--hc-primary-soft': c.primarySoft,
    '--hc-primary-hover': c.primaryHover,
    '--hc-accent-sage': c.accentSage,
    '--hc-accent-sky': c.accentSky,
    '--hc-accent-lavender': c.accentLavender,
    '--hc-accent-clay': c.accentClay,
    '--hc-accent-butter': c.accentButter,
    '--hc-danger': c.danger,
    '--hc-danger-soft': c.dangerSoft,
    '--hc-success': c.success,
    '--hc-success-soft': c.successSoft,
    '--hc-asset-image': c.assetImage,
    '--hc-asset-video': c.assetVideo,
    '--hc-asset-pdf': c.assetPdf,
    '--hc-asset-word': c.assetWord,
    '--hc-asset-file': c.assetFile,
    '--hc-code-bg': c.codeBg,
    '--hc-code-text': c.codeText,
    '--hc-code-muted': c.codeMuted,
    '--hc-code-control-bg': c.codeControlBg,
    '--hc-syntax-red': c.syntaxRed,
    '--hc-syntax-amber': c.syntaxAmber,
    '--hc-syntax-green': c.syntaxGreen,
    '--hc-syntax-purple': c.syntaxPurple,
    '--hc-syntax-sky': c.syntaxSky,
    '--hc-syntax-pink': c.syntaxPink,
    '--hc-syntax-orange': c.syntaxOrange,
    '--hc-syntax-teal': c.syntaxTeal,
    '--hc-shadow': c.shadow,
    '--hc-shadow-strong': c.shadowStrong,
  }
  for (const tone of HYPERCORTEX_TONES) {
    const toneColors = c.tones[tone]
    vars[`--hc-tone-${tone}-bg`] = toneColors.bg
    vars[`--hc-tone-${tone}-hover`] = toneColors.hover
    vars[`--hc-tone-${tone}-fg`] = toneColors.fg
  }
  return vars
}

export function createHyperCortexTheme(preset: HyperCortexColorPreset): Theme {
  return createTheme({
    palette: {
      mode: 'light',
      primary: { main: preset.colors.primary },
      error: { main: preset.colors.danger },
      background: { default: preset.colors.appBg, paper: preset.colors.surface },
      text: { primary: preset.colors.text, secondary: preset.colors.textMuted },
    },
    typography: {
      fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif',
    },
    components: lineFreeComponentOverrides,
  })
}
