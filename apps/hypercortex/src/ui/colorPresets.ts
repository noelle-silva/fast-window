import { createTheme, type Theme } from '@mui/material/styles'
import { HYPERCORTEX_COLOR_PRESET_IDS, type HyperCortexColorPresetIdV1 } from '../colorPresetIds'
import { lineFreeComponentOverrides } from './pluginUiStyles'
import { HYPERCORTEX_TONES } from './uiTones'
import { HYPERCORTEX_COLOR_PRESETS } from './colorPresetCatalog'
import type { HyperCortexColorPreset } from './colorPresetTypes'

export type { HyperCortexColorPreset, HyperCortexColorPresetColors } from './colorPresetTypes'
export { HYPERCORTEX_COLOR_PRESETS } from './colorPresetCatalog'

export const DEFAULT_COLOR_PRESET_ID: HyperCortexColorPresetIdV1 = 'dopamine-soft'

const COLOR_PRESET_BY_ID = buildColorPresetIndex()

function buildColorPresetIndex(): ReadonlyMap<HyperCortexColorPresetIdV1, HyperCortexColorPreset> {
  const index = new Map<HyperCortexColorPresetIdV1, HyperCortexColorPreset>()
  for (const preset of HYPERCORTEX_COLOR_PRESETS) {
    if (index.has(preset.id)) throw new Error(`Duplicate HyperCortex color preset id: ${preset.id}`)
    index.set(preset.id, preset)
  }
  for (const id of HYPERCORTEX_COLOR_PRESET_IDS) {
    if (!index.has(id)) throw new Error(`Missing HyperCortex color preset catalog entry: ${id}`)
  }
  if (index.size !== HYPERCORTEX_COLOR_PRESET_IDS.length) throw new Error('HyperCortex color preset catalog has unknown entries')
  return index
}

export function normalizeColorPresetId(value: unknown): HyperCortexColorPresetIdV1 {
  const id = String(value || '').trim()
  return COLOR_PRESET_BY_ID.has(id as HyperCortexColorPresetIdV1) ? (id as HyperCortexColorPresetIdV1) : DEFAULT_COLOR_PRESET_ID
}

export function getColorPreset(id: unknown): HyperCortexColorPreset {
  const normalized = normalizeColorPresetId(id)
  const preset = COLOR_PRESET_BY_ID.get(normalized)
  if (!preset) throw new Error(`HyperCortex color preset catalog is missing ${normalized}`)
  return preset
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
    '--hc-asset-epub': c.assetEpub,
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
