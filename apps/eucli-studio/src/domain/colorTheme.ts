export type ColorThemeMode = 'light' | 'dark'

export type ColorThemeColors = {
  canvas: string
  paper: string
  paperMuted: string
  paperStrong: string
  appBackground: string
  topbar: string
  composer: string
  field: string
  fieldHover: string
  fieldFocus: string
  primary: string
  primaryHover: string
  primarySoft: string
  secondary: string
  secondarySoft: string
  accent: string
  textPrimary: string
  textSecondary: string
  border: string
  shadowSoft: string
  shadowStrong: string
  focus: string
  codeBackground: string
  codeText: string
  success: string
  danger: string
  warning: string
}

export type ColorThemePreset = {
  id: string
  name: string
  description: string
  mode: ColorThemeMode
  colors: ColorThemeColors
}

export type ColorThemeSettings = {
  activePresetId: string
  importedPresets: ColorThemePreset[]
}

export const COLOR_THEME_SETTING_KEY = 'colorTheme'

export const COLOR_THEME_COLOR_KEYS: Array<keyof ColorThemeColors> = [
  'canvas',
  'paper',
  'paperMuted',
  'paperStrong',
  'appBackground',
  'topbar',
  'composer',
  'field',
  'fieldHover',
  'fieldFocus',
  'primary',
  'primaryHover',
  'primarySoft',
  'secondary',
  'secondarySoft',
  'accent',
  'textPrimary',
  'textSecondary',
  'border',
  'shadowSoft',
  'shadowStrong',
  'focus',
  'codeBackground',
  'codeText',
  'success',
  'danger',
  'warning',
]

export const COLOR_THEME_BUILTIN_PRESETS: ColorThemePreset[] = [
  {
    id: 'misty-blue',
    name: '晨雾蓝',
    description: '清透、低饱和的浅色工作台，适合长时间阅读和日常对话。',
    mode: 'light',
    colors: {
      canvas: '#eaf2f7',
      paper: '#fffaf3',
      paperMuted: '#e8f1ed',
      paperStrong: '#f7fbff',
      appBackground: '#eaf4ff',
      topbar: '#f8fbff',
      composer: '#fff7ed',
      field: 'rgba(238,247,244,.86)',
      fieldHover: 'rgba(255,251,235,.96)',
      fieldFocus: 'rgba(226,235,247,.98)',
      primary: '#4f72b8',
      primaryHover: '#3f5f9f',
      primarySoft: 'rgba(37,99,235,.12)',
      secondary: '#7c3aed',
      secondarySoft: 'rgba(124,58,237,.13)',
      accent: '#22c55e',
      textPrimary: '#0f172a',
      textSecondary: 'rgba(71,85,105,.88)',
      border: 'rgba(15,23,42,.12)',
      shadowSoft: '0 10px 26px rgba(15,23,42,.065)',
      shadowStrong: '0 24px 70px rgba(15,23,42,.18)',
      focus: '0 12px 30px rgba(37,99,235,.10)',
      codeBackground: '#0b1220',
      codeText: '#e5e7eb',
      success: '#16a34a',
      danger: '#dc2626',
      warning: '#d97706',
    },
  },
  {
    id: 'sakura-night',
    name: '暮樱墨',
    description: '偏暗的紫樱配色，降低白色刺激，突出沉浸式写作和夜间使用。',
    mode: 'dark',
    colors: {
      canvas: '#0d1020',
      paper: '#211827',
      paperMuted: '#121a2c',
      paperStrong: '#2b2437',
      appBackground: '#0d1020',
      topbar: '#151a2d',
      composer: '#261b2f',
      field: 'rgba(31,41,55,.72)',
      fieldHover: 'rgba(58,45,73,.76)',
      fieldFocus: 'rgba(93,70,105,.44)',
      primary: '#c884a6',
      primaryHover: '#b36f94',
      primarySoft: 'rgba(244,114,182,.16)',
      secondary: '#a78bfa',
      secondarySoft: 'rgba(167,139,250,.16)',
      accent: '#34d399',
      textPrimary: '#f8fafc',
      textSecondary: 'rgba(226,232,240,.72)',
      border: 'rgba(255,255,255,.12)',
      shadowSoft: '0 10px 30px rgba(0,0,0,.28)',
      shadowStrong: '0 26px 80px rgba(0,0,0,.42)',
      focus: '0 12px 34px rgba(244,114,182,.16)',
      codeBackground: '#08070d',
      codeText: '#f8fafc',
      success: '#34d399',
      danger: '#fb7185',
      warning: '#fbbf24',
    },
  },
  {
    id: 'macaron-cloud',
    name: '云朵马卡龙',
    description: '轻甜柔和的低饱和彩色层级，适合轻松、明亮的日常使用。',
    mode: 'light',
    colors: {
      canvas: '#f7f1fb',
      paper: '#fff7fb',
      paperMuted: '#edf7f3',
      paperStrong: '#f8fbff',
      appBackground: '#f7f1fb',
      topbar: '#f8fbff',
      composer: '#fff6ef',
      field: 'rgba(255,247,251,.88)',
      fieldHover: 'rgba(244,253,248,.96)',
      fieldFocus: 'rgba(235,238,247,.98)',
      primary: '#9a86c8',
      primaryHover: '#846fb5',
      primarySoft: 'rgba(139,92,246,.14)',
      secondary: '#f472b6',
      secondarySoft: 'rgba(244,114,182,.14)',
      accent: '#2dd4bf',
      textPrimary: '#312e4f',
      textSecondary: 'rgba(83,75,110,.78)',
      border: 'rgba(49,46,79,.13)',
      shadowSoft: '0 10px 26px rgba(49,46,79,.08)',
      shadowStrong: '0 24px 70px rgba(49,46,79,.16)',
      focus: '0 12px 30px rgba(139,92,246,.13)',
      codeBackground: '#25213a',
      codeText: '#f8fafc',
      success: '#10b981',
      danger: '#fb7185',
      warning: '#f59e0b',
    },
  },
  {
    id: 'moss-green',
    name: '苔林绿',
    description: '偏自然的绿色工作台，强调安静、护眼和稳定阅读。',
    mode: 'light',
    colors: {
      canvas: '#edf7ef',
      paper: '#fbfff7',
      paperMuted: '#dfeee4',
      paperStrong: '#f4fbf5',
      appBackground: '#edf7ef',
      topbar: '#f4fbf5',
      composer: '#f8f5e7',
      field: 'rgba(244,251,245,.9)',
      fieldHover: 'rgba(251,255,247,.98)',
      fieldFocus: 'rgba(225,241,229,.96)',
      primary: '#4f7f5b',
      primaryHover: '#426d50',
      primarySoft: 'rgba(21,128,61,.13)',
      secondary: '#0f766e',
      secondarySoft: 'rgba(15,118,110,.12)',
      accent: '#84cc16',
      textPrimary: '#17351f',
      textSecondary: 'rgba(43,75,52,.78)',
      border: 'rgba(23,53,31,.14)',
      shadowSoft: '0 10px 26px rgba(23,53,31,.08)',
      shadowStrong: '0 24px 70px rgba(23,53,31,.16)',
      focus: '0 12px 30px rgba(21,128,61,.13)',
      codeBackground: '#102016',
      codeText: '#ecfdf5',
      success: '#16a34a',
      danger: '#dc2626',
      warning: '#ca8a04',
    },
  },
  {
    id: 'peach-pink',
    name: '蜜桃粉',
    description: '温柔明亮的粉桃色层级，适合轻快、亲和的聊天氛围。',
    mode: 'light',
    colors: {
      canvas: '#fff1f2',
      paper: '#fffaf7',
      paperMuted: '#fde7ec',
      paperStrong: '#fff5f7',
      appBackground: '#fff1f2',
      topbar: '#fff5f7',
      composer: '#fff3e8',
      field: 'rgba(255,245,247,.9)',
      fieldHover: 'rgba(255,250,247,.98)',
      fieldFocus: 'rgba(249,232,233,.98)',
      primary: '#c06a78',
      primaryHover: '#a85a67',
      primarySoft: 'rgba(225,29,72,.12)',
      secondary: '#f97316',
      secondarySoft: 'rgba(249,115,22,.12)',
      accent: '#ec4899',
      textPrimary: '#4a1d2a',
      textSecondary: 'rgba(100,54,66,.78)',
      border: 'rgba(74,29,42,.13)',
      shadowSoft: '0 10px 26px rgba(74,29,42,.08)',
      shadowStrong: '0 24px 70px rgba(74,29,42,.16)',
      focus: '0 12px 30px rgba(225,29,72,.13)',
      codeBackground: '#2b1220',
      codeText: '#fff1f2',
      success: '#16a34a',
      danger: '#dc2626',
      warning: '#ea580c',
    },
  },
  {
    id: 'wisteria-purple',
    name: '紫藤雾',
    description: '清爽的紫色层级，适合更有幻想感和专注感的工作台。',
    mode: 'light',
    colors: {
      canvas: '#f3efff',
      paper: '#fbf8ff',
      paperMuted: '#e9ddff',
      paperStrong: '#f8f5ff',
      appBackground: '#f3efff',
      topbar: '#f8f5ff',
      composer: '#f2edff',
      field: 'rgba(248,245,255,.9)',
      fieldHover: 'rgba(251,248,255,.98)',
      fieldFocus: 'rgba(235,230,247,.98)',
      primary: '#8870bd',
      primaryHover: '#7660aa',
      primarySoft: 'rgba(124,58,237,.13)',
      secondary: '#a855f7',
      secondarySoft: 'rgba(168,85,247,.13)',
      accent: '#06b6d4',
      textPrimary: '#2e214f',
      textSecondary: 'rgba(79,70,110,.78)',
      border: 'rgba(46,33,79,.13)',
      shadowSoft: '0 10px 26px rgba(46,33,79,.08)',
      shadowStrong: '0 24px 70px rgba(46,33,79,.16)',
      focus: '0 12px 30px rgba(124,58,237,.13)',
      codeBackground: '#211536',
      codeText: '#f5f3ff',
      success: '#16a34a',
      danger: '#dc2626',
      warning: '#d97706',
    },
  },
  {
    id: 'parchment-scroll',
    name: '羊皮纸',
    description: '温暖的纸张色层级，适合写作、阅读和复古笔记氛围。',
    mode: 'light',
    colors: {
      canvas: '#f3ead7',
      paper: '#fff8e8',
      paperMuted: '#eadcc0',
      paperStrong: '#fff3d2',
      appBackground: '#f3ead7',
      topbar: '#fff3d2',
      composer: '#f8e7bf',
      field: 'rgba(255,248,232,.9)',
      fieldHover: 'rgba(255,252,242,.98)',
      fieldFocus: 'rgba(249,239,213,.98)',
      primary: '#9a7046',
      primaryHover: '#84603c',
      primarySoft: 'rgba(146,64,14,.13)',
      secondary: '#a16207',
      secondarySoft: 'rgba(161,98,7,.13)',
      accent: '#b45309',
      textPrimary: '#3f2f1c',
      textSecondary: 'rgba(91,65,38,.78)',
      border: 'rgba(63,47,28,.16)',
      shadowSoft: '0 10px 26px rgba(63,47,28,.09)',
      shadowStrong: '0 24px 70px rgba(63,47,28,.18)',
      focus: '0 12px 30px rgba(146,64,14,.14)',
      codeBackground: '#2f2115',
      codeText: '#fef3c7',
      success: '#15803d',
      danger: '#b91c1c',
      warning: '#b45309',
    },
  },
]

const BUILTIN_PRESET_IDS = new Set(COLOR_THEME_BUILTIN_PRESETS.map((preset) => preset.id))

function cleanText(value: unknown, maxLength: number) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, maxLength)
}

function assertSafeCssValue(value: string, fieldName: string) {
  const v = String(value || '').trim()
  if (!v) throw new Error(`${fieldName} 不能为空`)
  if (v.length > 280) throw new Error(`${fieldName} 过长`)
  if (/[;{}<>]/.test(v)) throw new Error(`${fieldName} 包含不允许的字符`)
  if (/gradient\s*\(/i.test(v)) throw new Error(`${fieldName} 不允许使用渐变`)
  if (/url\s*\(|expression\s*\(|@import|javascript:/i.test(v)) throw new Error(`${fieldName} 不能包含外部资源或脚本表达式`)
  if (!/^[a-z0-9#.,%\s()\-]+$/i.test(v)) throw new Error(`${fieldName} 包含不支持的 CSS 片段`)
  return v
}

function normalizePresetId(value: unknown, fallbackId: string) {
  const raw = String(value || '').trim().toLowerCase()
  const id = raw.replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
  return id || fallbackId
}

export function normalizeColorThemePreset(raw: unknown, fallbackId: string): ColorThemePreset {
  if (!raw || typeof raw !== 'object') throw new Error('配色预设必须是对象')
  const obj = raw as any
  const name = cleanText(obj.name, 40)
  if (!name) throw new Error('配色预设缺少 name')
  const colorsRaw = obj.colors && typeof obj.colors === 'object' ? obj.colors : null
  if (!colorsRaw) throw new Error('配色预设缺少 colors')

  const colors = {} as ColorThemeColors
  for (const key of COLOR_THEME_COLOR_KEYS) {
    const value = colorsRaw[key]
    if (typeof value !== 'string') throw new Error(`colors.${key} 必须是字符串`)
    colors[key] = assertSafeCssValue(value, `colors.${key}`)
  }

  const modeRaw = String(obj.mode || 'light').trim()
  return {
    id: normalizePresetId(obj.id, fallbackId),
    name,
    description: cleanText(obj.description, 120),
    mode: modeRaw === 'dark' ? 'dark' : 'light',
    colors,
  }
}

export function normalizeColorThemeSettings(raw: unknown): ColorThemeSettings {
  const obj = raw && typeof raw === 'object' ? (raw as any) : {}
  const importedPresets = Array.isArray(obj.importedPresets)
    ? obj.importedPresets
        .map((preset: unknown, index: number) => {
          try {
            const normalized = normalizeColorThemePreset(preset, `imported-${index + 1}`)
            return BUILTIN_PRESET_IDS.has(normalized.id) ? { ...normalized, id: `imported-${index + 1}` } : normalized
          } catch (_) {
            return null
          }
        })
        .filter((preset: ColorThemePreset | null): preset is ColorThemePreset => !!preset)
    : []

  const allIds = new Set<string>([...COLOR_THEME_BUILTIN_PRESETS.map((preset: ColorThemePreset) => preset.id), ...importedPresets.map((preset: ColorThemePreset) => preset.id)])
  const activePresetId = String(obj.activePresetId || '').trim()
  return {
    activePresetId: allIds.has(activePresetId) ? activePresetId : COLOR_THEME_BUILTIN_PRESETS[0].id,
    importedPresets,
  }
}

export function listColorThemePresets(settings: unknown) {
  const normalized = normalizeColorThemeSettings(settings)
  return [...COLOR_THEME_BUILTIN_PRESETS, ...normalized.importedPresets]
}

export function resolveColorThemePreset(settings: unknown): ColorThemePreset {
  const normalized = normalizeColorThemeSettings(settings)
  return listColorThemePresets(normalized).find((preset) => preset.id === normalized.activePresetId) || COLOR_THEME_BUILTIN_PRESETS[0]
}

export function parseColorThemePresetImport(jsonText: string, idFactory: () => string): ColorThemePreset[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch (_) {
    throw new Error('导入失败：JSON 格式不正确')
  }

  const source = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as any).presets)
      ? (parsed as any).presets
      : [parsed]

  if (!source.length) throw new Error('导入失败：没有找到配色预设')
  return source.map((item: unknown, index: number) => normalizeColorThemePreset(item, `imported-${idFactory()}-${index + 1}`))
}

export function mergeImportedColorThemePresets(settings: unknown, presets: ColorThemePreset[]): ColorThemeSettings {
  const normalized = normalizeColorThemeSettings(settings)
  const byId = new Map<string, ColorThemePreset>()
  for (const preset of normalized.importedPresets) byId.set(preset.id, preset)
  for (const preset of presets) {
    const id = BUILTIN_PRESET_IDS.has(preset.id) ? `imported-${preset.id}` : preset.id
    byId.set(id, { ...preset, id })
  }
  const importedPresets = Array.from(byId.values()).slice(-40)
  return {
    activePresetId: presets[0]?.id ? (BUILTIN_PRESET_IDS.has(presets[0].id) ? `imported-${presets[0].id}` : presets[0].id) : normalized.activePresetId,
    importedPresets,
  }
}
