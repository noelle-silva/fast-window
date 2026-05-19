export const HYPERCORTEX_COLOR_PRESET_IDS = [
  'dopamine-soft',
  'claude-paper',
  'solarized-linen',
  'rose-pine-dawn',
  'gruvbox-walnut',
  'tokyo-day',
  'bauhaus-signal',
] as const

export type HyperCortexColorPresetIdV1 = typeof HYPERCORTEX_COLOR_PRESET_IDS[number]
